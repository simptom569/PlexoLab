// Черновик холста документа: объекты, стрелки и положение карточки с текстом, которые человек двигает, и их сохранение.
//
// Пока объект тащат, меняется только локальное состояние (`change` с `save: false`): на сервер ничего не уходит.
// Когда указатель отпустили, вызывается `commit`, и холст целиком уходит одним запросом. Правки, которые идут не от
// указателя (текст и цвет объекта, новый объект, стрелка), сохраняются через короткую паузу, а при уходе с экрана сразу.
//
// Холст сохраняется без проверки версии: последнее сохранение побеждает. Версия `canvas_rev` нужна, чтобы отличить
// свежее состояние сервера от запоздавшего ответа: принимается только более новая версия, и только пока своих
// несохранённых правок нет.

import type { SavedCanvas } from '../../lib/api/types'
import { sameCanvas, type CanvasState } from './canvas'

/** Пауза после последней правки перед сохранением */
export const CANVAS_SAVE_DELAY_MS = 600
/** Через сколько повторять сохранение, если сервер не ответил */
export const CANVAS_RETRY_MS = 5_000

export type CanvasDraftDeps = {
  /** PUT /docs/{id}/canvas */
  put: (id: string, canvas: CanvasState) => Promise<SavedCanvas>
  /** Холст сохранён: ответ сервера → кэш */
  onSaved: (id: string, saved: SavedCanvas) => void
  /** Сохранить не вышло: сообщить человеку (повтор запланирован) */
  onError: () => void
}

/** То, что известно о холсте с сервера */
export type ServerCanvas = Pick<SavedCanvas, 'canvas_rev' | 'note' | 'objects' | 'links'>

const toState = (c: ServerCanvas): CanvasState => ({ note: { ...c.note }, objects: c.objects, links: c.links })

export class CanvasDraft {
  private readonly listeners = new Set<() => void>()
  private state: CanvasState
  private rev: number
  /** Сколько раз менялось состояние и на какой правке оно известно серверу */
  private version = 0
  private savedVersion = 0
  private inFlight = false
  private disposed = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly id: string
  private readonly deps: CanvasDraftDeps

  constructor(id: string, server: ServerCanvas, deps: CanvasDraftDeps) {
    this.id = id
    this.deps = deps
    this.rev = server.canvas_rev
    this.state = toState(server)
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  getState = (): CanvasState => this.state

  /** Есть ли то, что ещё не ушло на сервер */
  get dirty(): boolean {
    return this.version !== this.savedVersion
  }

  /**
   * Меняет холст. `save: false` — правка «на лету» (объект тащат): на сервер уйдёт по `commit`.
   * Правка, которая ничего не изменила, не считается.
   */
  change(update: (s: CanvasState) => CanvasState, { save = true }: { save?: boolean } = {}) {
    const next = update(this.state)
    if (sameCanvas(next, this.state)) return
    this.state = next
    this.version++
    for (const l of this.listeners) l()
    if (save) this.schedule()
  }

  /** Указатель отпустили: сохранить сразу, без паузы */
  commit() {
    void this.flush()
  }

  /** Сохранить сейчас. Промис готов, когда всё отправленное дошло до сервера. */
  async flush(): Promise<void> {
    clearTimeout(this.timer)
    await this.save()
  }

  /**
   * Состояние с сервера (перечитали документ): принимается, только если оно новее известного и своих несохранённых
   * правок нет. Иначе своё сохранение само запишется поверх.
   */
  adopt(server: ServerCanvas) {
    if (server.canvas_rev <= this.rev || this.dirty || this.inFlight) return
    this.rev = server.canvas_rev
    const next = toState(server)
    if (sameCanvas(next, this.state)) return
    this.state = next
    for (const l of this.listeners) l()
  }

  /** Документ удалили: ждущие сохранения отменяются, чтобы не слать холст в никуда */
  dispose() {
    this.disposed = true
    clearTimeout(this.timer)
  }

  private schedule() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.save(), CANVAS_SAVE_DELAY_MS)
  }

  private async save() {
    if (this.disposed || !this.dirty) return
    if (this.inFlight) return // после ответа сохранение повторится само, если за это время что-то менялось
    this.inFlight = true
    const sent = this.state
    const version = this.version
    let ok = false
    try {
      const saved = await this.deps.put(this.id, sent)
      this.rev = Math.max(this.rev, saved.canvas_rev)
      this.savedVersion = version
      ok = true
      this.deps.onSaved(this.id, saved)
    } catch {
      if (!this.disposed) {
        this.deps.onError()
        this.timer = setTimeout(() => void this.save(), CANVAS_RETRY_MS)
      }
    } finally {
      this.inFlight = false
    }
    // пока шёл запрос, холст менялся (тащили дальше, печатали): отправляем то, что стало
    if (ok && this.dirty) await this.save()
  }
}
