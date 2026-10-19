// Черновик страницы вики или документа: текст и название, которые человек правит, и их сохранение на сервер.
//
// Сохранение идёт с задержкой (600 мс после последней правки) и сразу при выходе из редактирования. Сервер хранит
// номер версии `rev`: каждое сохранение отправляет ту версию, которую клиент видел последней. Если страницу успел
// изменить другой участник, сервер отвечает 409 и отдаёт его версию. Тогда сохранение останавливается, и человек
// выбирает: взять чужую версию или оставить свою. Черновик живёт вне компонента: если уйти со страницы, не дождавшись
// сохранения, оно всё равно закончится, а вернувшись, человек увидит свой текст, а не старый.
// Один и тот же класс держит и страницы вики (`WikiPage`), и документы (`Doc`): им нужны только id, название, текст и версия.

import { ApiError } from '../../lib/api/client'
import type { WikiPage } from '../../lib/api/types'

/** Всё, что черновику нужно знать о странице или документе */
export type Versioned = { id: string; title: string; md: string; rev: number }

/** Пауза после последней правки перед сохранением */
export const SAVE_DELAY_MS = 600
/** Через сколько повторять сохранение, если сервер не ответил */
export const RETRY_MS = 5_000

export type DraftState<P extends Versioned = WikiPage> = {
  title: string
  md: string
  /** Чужая версия, если страницу успели изменить; пока она есть, ничего не сохраняется */
  conflict: P | null
  /** Растёт, когда текст заменили снаружи (чужая версия): редактор должен начаться заново */
  resetKey: number
}

export type DraftDeps<P extends Versioned = WikiPage> = {
  /** PATCH /wiki/{id} или /docs/{id}; при 409 бросает ApiError с `body.current` */
  patch: (id: string, body: { rev: number; title?: string; md?: string }) => Promise<P>
  /** Версия страницы с сервера стала известна (после сохранения или при выборе чужой версии) */
  onSaved: (page: P) => void
  /** Сохранить не вышло: сообщить человеку (повтор запланирован) */
  onError: () => void
}

const isConflict = <P extends Versioned>(e: unknown): e is ApiError & { body: { current: P } } =>
  e instanceof ApiError && e.status === 409 && !!(e.body as { current?: P } | undefined)?.current

type Fields = { title: string; md: string }

export class PageDraft<P extends Versioned = WikiPage> {
  private readonly listeners = new Set<() => void>()
  private rev: number
  /** Последнее, что известно с сервера */
  private saved: Fields
  private title: string
  private md: string
  private conflict: P | null = null
  private resetKey = 0
  private inFlight = false
  private disposed = false
  private again = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private snapshot: DraftState<P>
  private readonly id: string
  private readonly deps: DraftDeps<P>

  constructor(page: P, deps: DraftDeps<P>) {
    this.id = page.id
    this.deps = deps
    this.rev = page.rev
    this.saved = { title: page.title, md: page.md }
    this.title = page.title
    this.md = page.md
    this.snapshot = this.build()
  }

  // ----- чтение (для useSyncExternalStore) -----

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  getState = (): DraftState<P> => this.snapshot

  /** Есть ли то, что ещё не ушло на сервер */
  get dirty(): boolean {
    return this.body() !== null
  }

  // ----- правки -----

  setMd(md: string) {
    if (md === this.md) return
    this.md = md
    this.changed()
    this.schedule()
  }

  setTitle(title: string) {
    if (title === this.title) return
    this.title = title
    this.changed()
    this.schedule()
  }

  /** Сохранить сейчас, не ожидая паузы. Промис готов, когда всё отправленное дошло до сервера. */
  async flush(): Promise<void> {
    clearTimeout(this.timer)
    await this.save()
  }

  /**
   * Новая версия с сервера (перечитали страницу): принимается, только если своих несохранённых правок нет.
   * Иначе сохранение само разберётся: либо запишет правки поверх, либо получит 409.
   */
  adopt(page: P) {
    if (page.rev <= this.rev || this.dirty || this.inFlight || this.conflict) return
    this.take(page)
  }

  /** Страницу удалили: ждущие сохранения отменяются, чтобы не слать правки в никуда */
  dispose() {
    this.disposed = true
    clearTimeout(this.timer)
  }

  /** «Загрузить его версию»: свой текст отбрасывается */
  acceptTheirs() {
    const theirs = this.conflict
    if (!theirs) return
    clearTimeout(this.timer)
    this.conflict = null
    this.take(theirs)
    this.deps.onSaved(theirs)
  }

  /** «Оставить мою»: свой текст записывается поверх чужой версии */
  keepMine() {
    const theirs = this.conflict
    if (!theirs) return
    this.rev = theirs.rev
    this.conflict = null
    this.changed()
    void this.flush()
  }

  // ----- внутреннее -----

  private build(): DraftState<P> {
    return { title: this.title, md: this.md, conflict: this.conflict, resetKey: this.resetKey }
  }

  private changed() {
    this.snapshot = this.build()
    for (const l of this.listeners) l()
  }

  private schedule() {
    clearTimeout(this.timer)
    if (this.conflict) return
    this.timer = setTimeout(() => void this.save(), SAVE_DELAY_MS)
  }

  /** Заменяет черновик версией с сервера */
  private take(page: P) {
    const textChanged = page.md !== this.md
    this.rev = page.rev
    this.saved = { title: page.title, md: page.md }
    this.title = page.title
    this.md = page.md
    if (textChanged) this.resetKey++
    this.changed()
  }

  /** Что отправить: только изменённое. Название сравнивается без пробелов по краям, их срезает сервер. */
  private body(): { title?: string; md?: string } | null {
    const body: { title?: string; md?: string } = {}
    if (this.title.trim() !== this.saved.title) body.title = this.title
    if (this.md !== this.saved.md) body.md = this.md
    return body.title === undefined && body.md === undefined ? null : body
  }

  private async save() {
    if (this.conflict || this.disposed) return
    if (this.inFlight) {
      this.again = true
      return
    }
    const body = this.body()
    if (!body) return

    this.inFlight = true
    try {
      const page = await this.deps.patch(this.id, { ...body, rev: this.rev })
      this.saveSucceeded(page, body)
    } catch (e) {
      if (isConflict<P>(e)) {
        this.conflict = e.body.current
        this.changed()
      } else {
        if (!this.disposed) {
          this.deps.onError()
          this.timer = setTimeout(() => void this.save(), RETRY_MS)
        }
      }
    } finally {
      this.inFlight = false
    }
    if (this.again) {
      this.again = false
      await this.save()
    }
  }

  private saveSucceeded(page: P, sent: { title?: string; md?: string }) {
    this.rev = page.rev
    let replaced = false
    // отправленное поле теперь известно как есть на сервере; не отправленное, если его не трогали, подтягивается с сервера
    if (sent.title !== undefined) this.saved.title = page.title
    else if (this.title.trim() === this.saved.title) {
      replaced ||= page.title !== this.title
      this.saved.title = page.title
      this.title = page.title
    }
    if (sent.md !== undefined) this.saved.md = page.md
    else if (this.md === this.saved.md) {
      if (page.md !== this.md) {
        this.resetKey++
        replaced = true
      }
      this.saved.md = page.md
      this.md = page.md
    }
    if (replaced) this.changed()
    this.deps.onSaved(page)
  }
}
