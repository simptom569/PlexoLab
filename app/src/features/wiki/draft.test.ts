import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/api/client'
import { OfflineError } from '../../lib/link'
import { NetworkError } from '../../lib/platform/http'
import type { WikiPage } from '../../lib/api/types'
import { MAX_MERGES, ORPHAN_GRACE_MS, PageDraft, RETRY_MS, SAVE_DELAY_MS, type DraftDeps } from './draft'

const page = (o: Partial<WikiPage> = {}): WikiPage => ({
  id: 'p1',
  parent_id: null,
  title: 'Архитектура',
  md: 'Старый текст',
  position: 1024,
  rev: 1,
  updated_by: null,
  updated_at: '2026-10-18T12:00:00Z',
  ...o,
})

type Body = { rev: number; title?: string; md?: string }

/** Сервер на минималках: версия растёт на каждое изменение, чужие правки добавляются в `server` */
function setup(initial: WikiPage = page(), { withCopy = false }: { withCopy?: boolean } = {}) {
  const server = { page: initial }
  const calls: Body[] = []
  // копии, сохранённые для ушедшего человека (`withCopy`); `copyFail.next` — следующую копию сохранить не удастся
  const copies: Array<{ original: WikiPage; mine: { title: string; md: string } }> = []
  const copyFail = { next: null as unknown }
  let gate: Promise<void> | null = null
  const fail = { next: null as unknown }
  const deps: DraftDeps = {
    patch: vi.fn(async (_id, body) => {
      calls.push(body)
      if (gate) await gate
      if (fail.next) {
        const e = fail.next
        fail.next = null
        throw e
      }
      const cur = server.page
      if (body.rev !== cur.rev) {
        throw new ApiError(409, 'conflict', 'Страницу изменил другой участник', { code: 'conflict', current: cur })
      }
      server.page = { ...cur, title: body.title?.trim() ?? cur.title, md: body.md ?? cur.md, rev: cur.rev + 1 }
      return server.page
    }),
    onSaved: vi.fn(),
    onError: vi.fn(),
    ...(withCopy
      ? {
          saveCopy: vi.fn(async (original: WikiPage, mine: { title: string; md: string }) => {
            if (copyFail.next) {
              const e = copyFail.next
              copyFail.next = null
              throw e
            }
            copies.push({ original, mine })
            return `${mine.title} (копия)`
          }),
          onCopySaved: vi.fn(),
        }
      : {}),
  }
  const draft = new PageDraft(initial, deps)
  return {
    draft,
    deps,
    calls,
    copies,
    copyFail,
    server,
    fail,
    /** Следующие ответы сервера ждут, пока не вызовут `open()` */
    hold() {
      let open!: () => void
      gate = new Promise<void>((r) => (open = r))
      return () => {
        gate = null
        open()
      }
    },
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('сохранение с задержкой', () => {
  it('серия правок даёт один запрос с последним текстом через 600 мс после последней', async () => {
    const t = setup()
    t.draft.setMd('П')
    await vi.advanceTimersByTimeAsync(400)
    t.draft.setMd('Пр')
    await vi.advanceTimersByTimeAsync(400)
    t.draft.setMd('При')
    expect(t.calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1)
    expect(t.calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(t.calls).toEqual([{ rev: 1, md: 'При' }])
  })

  it('отправляется только изменённое: текст или название', async () => {
    const t = setup()
    t.draft.setTitle('Новое название')
    await t.draft.flush()
    expect(t.calls[0]).toEqual({ rev: 1, title: 'Новое название' })
    t.draft.setMd('Новый текст')
    await t.draft.flush()
    expect(t.calls[1]).toEqual({ rev: 2, md: 'Новый текст' })
  })

  it('flush сохраняет сразу и не ждёт паузы', async () => {
    const t = setup()
    t.draft.setMd('Срочно')
    await t.draft.flush()
    expect(t.calls).toEqual([{ rev: 1, md: 'Срочно' }])
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2)
    expect(t.calls).toHaveLength(1)
  })

  it('без изменений запроса нет: возврат к прежнему тексту отменяет сохранение', async () => {
    const t = setup()
    t.draft.setMd('Другое')
    t.draft.setMd('Старый текст')
    await t.draft.flush()
    expect(t.calls).toHaveLength(0)
    expect(t.draft.dirty).toBe(false)
  })

  it('название сравнивается без пробелов по краям: лишних запросов нет', async () => {
    const t = setup()
    t.draft.setTitle('Архитектура   ')
    await t.draft.flush()
    expect(t.calls).toHaveLength(0)
    t.draft.setTitle('  Новое  ')
    await t.draft.flush()
    expect(t.draft.getState().title).toBe('  Новое  ')
    t.draft.setMd('Текст')
    await t.draft.flush()
    expect(t.calls.map((c) => c.title)).toEqual(['  Новое  ', undefined])
  })

  it('версия берётся из ответа сервера, ответ уходит в кэш', async () => {
    const t = setup()
    t.draft.setMd('Раз')
    await t.draft.flush()
    t.draft.setMd('Два')
    await t.draft.flush()
    expect(t.calls.map((c) => c.rev)).toEqual([1, 2])
    expect(t.deps.onSaved).toHaveBeenLastCalledWith(expect.objectContaining({ rev: 3, md: 'Два' }))
  })

  it('правка во время отправки уходит следующим запросом уже с новой версией', async () => {
    const t = setup()
    const open = t.hold()
    t.draft.setMd('Первая')
    const first = t.draft.flush()
    await vi.advanceTimersByTimeAsync(0)
    t.draft.setMd('Вторая')
    const second = t.draft.flush() // пока первый не вернулся: ставится в очередь
    expect(t.calls).toHaveLength(1)
    open()
    await Promise.all([first, second])
    expect(t.calls).toEqual([
      { rev: 1, md: 'Первая' },
      { rev: 2, md: 'Вторая' },
    ])
    expect(t.server.page.md).toBe('Вторая')
  })

  it('таймер правки, сработавший во время отправки, не теряется', async () => {
    const t = setup()
    const open = t.hold()
    t.draft.setMd('Первая')
    void t.draft.flush()
    await vi.advanceTimersByTimeAsync(0)
    t.draft.setMd('Вторая')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    open()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.calls.map((c) => c.md)).toEqual(['Первая', 'Вторая'])
  })
})

describe('конфликт версий', () => {
  async function conflicted() {
    const t = setup()
    t.server.page = page({ rev: 2, md: 'Текст соседа', title: 'Название соседа' })
    t.draft.setMd('Мой текст')
    await t.draft.flush()
    return t
  }

  it('409 останавливает сохранение и отдаёт чужую версию', async () => {
    const t = await conflicted()
    expect(t.draft.getState().conflict).toMatchObject({ rev: 2, md: 'Текст соседа' })
    expect(t.draft.getState().md).toBe('Мой текст')
    expect(t.deps.onError).not.toHaveBeenCalled()

    t.draft.setMd('Мой текст, ещё')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 3)
    expect(t.calls).toHaveLength(1)
  })

  it('«Загрузить его версию» заменяет свой текст и просит редактор начаться заново', async () => {
    const t = await conflicted()
    const resetBefore = t.draft.getState().resetKey
    t.draft.acceptTheirs()
    const s = t.draft.getState()
    expect(s).toMatchObject({ md: 'Текст соседа', title: 'Название соседа', conflict: null })
    expect(s.resetKey).toBe(resetBefore + 1)
    expect(t.draft.dirty).toBe(false)
    expect(t.deps.onSaved).toHaveBeenCalledWith(expect.objectContaining({ rev: 2 }))
    // дальше сохранение работает с версией соседа
    t.draft.setMd('Дальше');
    await t.draft.flush()
    expect(t.calls.at(-1)).toEqual({ rev: 2, md: 'Дальше' })
  })

  it('«Оставить мою» записывает свой текст поверх, чужое название остаётся', async () => {
    const t = await conflicted()
    t.draft.keepMine()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.calls.at(-1)).toEqual({ rev: 2, md: 'Мой текст' })
    expect(t.server.page).toMatchObject({ rev: 3, md: 'Мой текст', title: 'Название соседа' })
    expect(t.draft.getState().conflict).toBeNull()
    expect(t.draft.getState().title).toBe('Название соседа')
  })
})

describe('человек ушёл со страницы, а правки не слились', () => {
  /** Свой текст правит человек, чужой ушёл на сервер раньше: настоящий конфликт, на экране никого нет */
  async function orphaned(subscribed = false) {
    const t = setup(page(), { withCopy: true })
    const off = subscribed ? t.draft.subscribe(() => undefined) : null
    t.server.page = page({ rev: 2, md: 'Текст соседа', title: 'Название соседа' })
    t.draft.setMd('Мой текст')
    await t.draft.flush()
    return { t, off }
  }

  it('правки сохраняются отдельной страницей, а сама страница становится чужой версией', async () => {
    const { t } = await orphaned()
    expect(t.copies).toHaveLength(0) // сначала короткая пауза: экран мог просто пересоздаться
    await vi.advanceTimersByTimeAsync(ORPHAN_GRACE_MS)

    expect(t.copies).toHaveLength(1)
    expect(t.copies[0]!.original).toMatchObject({ rev: 2, md: 'Текст соседа' })
    expect(t.copies[0]!.mine).toEqual({ title: 'Архитектура', md: 'Мой текст' })
    expect(t.draft.getState()).toMatchObject({ conflict: null, md: 'Текст соседа', title: 'Название соседа', rev: 2 })
    expect(t.draft.dirty).toBe(false)
    expect(t.deps.onSaved).toHaveBeenCalledWith(expect.objectContaining({ rev: 2 }))
    expect(t.deps.onCopySaved).toHaveBeenCalledWith('Архитектура (копия)')
    expect(t.deps.onError).not.toHaveBeenCalled()
    // после копии страница снова обычная: сохранение идёт с версией соседа
    t.draft.setMd('Дальше')
    await t.draft.flush()
    expect(t.calls.at(-1)).toEqual({ rev: 2, md: 'Дальше' })
    expect(t.copies).toHaveLength(1)
  })

  it('человек на странице: копии нет, остаётся баннер', async () => {
    const { t, off } = await orphaned(true)
    await vi.advanceTimersByTimeAsync(ORPHAN_GRACE_MS * 10)
    expect(t.copies).toHaveLength(0)
    expect(t.draft.getState().conflict).toMatchObject({ rev: 2 })
    expect(t.draft.getState().md).toBe('Мой текст')
    off?.()
  })

  it('человек ушёл, не выбрав на баннере: правки тоже уходят в копию', async () => {
    const { t, off } = await orphaned(true)
    expect(t.draft.getState().conflict).not.toBeNull()
    off!() // закрыл страницу с баннером
    await vi.advanceTimersByTimeAsync(ORPHAN_GRACE_MS)
    expect(t.copies).toHaveLength(1)
    expect(t.draft.getState()).toMatchObject({ conflict: null, md: 'Текст соседа' })
  })

  it('вернулся в течение паузы: копии нет, баннер ждёт', async () => {
    const { t } = await orphaned()
    await vi.advanceTimersByTimeAsync(ORPHAN_GRACE_MS - 100)
    const off = t.draft.subscribe(() => undefined)
    await vi.advanceTimersByTimeAsync(ORPHAN_GRACE_MS * 5)
    expect(t.copies).toHaveLength(0)
    expect(t.draft.getState().conflict).not.toBeNull()
    off()
  })

  it('разошлись только названия, текст слился: копия не нужна, остаётся чужое название', async () => {
    const t = setup(page({ md: 'Первый\n\nВторой' }), { withCopy: true })
    t.server.page = page({ rev: 2, md: 'Первый\n\nВторой', title: 'Название соседа' })
    t.draft.setTitle('Моё название')
    t.draft.setMd('Первый\n\nВторой (я)')
    await t.draft.flush()
    await vi.advanceTimersByTimeAsync(ORPHAN_GRACE_MS)

    expect(t.copies).toHaveLength(0)
    expect(t.draft.getState()).toMatchObject({ conflict: null, title: 'Название соседа', md: 'Первый\n\nВторой (я)' })
    expect(t.server.page.md).toBe('Первый\n\nВторой (я)')
    expect(t.server.page.title).toBe('Название соседа')
  })

  it('человек на странице и названия разошлись: прежний баннер', async () => {
    const t = setup(page(), { withCopy: true })
    const off = t.draft.subscribe(() => undefined)
    t.server.page = page({ rev: 2, title: 'Название соседа' })
    t.draft.setTitle('Моё название')
    await t.draft.flush()
    expect(t.draft.getState().conflict).toMatchObject({ rev: 2 })
    off()
  })

  it('связи нет: правки остаются, копия сохраняется повтором, и только одна', async () => {
    const { t } = await orphaned()
    t.copyFail.next = new NetworkError('Нет связи с сервером')
    await vi.advanceTimersByTimeAsync(ORPHAN_GRACE_MS)
    expect(t.copies).toHaveLength(0)
    expect(t.draft.getState().conflict).not.toBeNull()
    expect(t.deps.onError).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(RETRY_MS)
    expect(t.copies).toHaveLength(1)
    expect(t.draft.getState().conflict).toBeNull()
    await vi.advanceTimersByTimeAsync(RETRY_MS * 3)
    expect(t.copies).toHaveLength(1)
  })

  it('сервер отказал в копии: плашка об ошибке, правки остаются, ждёт баннер без повторов', async () => {
    const { t } = await orphaned()
    t.copyFail.next = new ApiError(400, 'bad_request', 'Название: слишком длинное')
    await vi.advanceTimersByTimeAsync(ORPHAN_GRACE_MS)
    expect(t.deps.onError).toHaveBeenCalledTimes(1)
    expect(t.copies).toHaveLength(0)
    expect(t.draft.getState()).toMatchObject({ md: 'Мой текст' })
    expect(t.draft.getState().conflict).not.toBeNull()
    await vi.advanceTimersByTimeAsync(RETRY_MS * 3)
    expect(t.deps.onError).toHaveBeenCalledTimes(1)
  })

  it('без saveCopy конфликт ждёт человека, как раньше', async () => {
    const t = setup()
    t.server.page = page({ rev: 2, md: 'Текст соседа' })
    t.draft.setMd('Мой текст')
    await t.draft.flush()
    await vi.advanceTimersByTimeAsync(ORPHAN_GRACE_MS * 10)
    expect(t.draft.getState().conflict).toMatchObject({ rev: 2 })
  })

  it('dispose отменяет ожидающую копию', async () => {
    const { t } = await orphaned()
    t.draft.dispose()
    await vi.advanceTimersByTimeAsync(ORPHAN_GRACE_MS * 5)
    expect(t.copies).toHaveLength(0)
  })
})

describe('слияние при конфликте', () => {
  const three = 'Первый\n\nВторой\n\nТретий'

  it('правки в разных местах склеиваются и уходят на сервер поверх чужой версии', async () => {
    const t = setup(page({ md: three }))
    t.server.page = page({ rev: 2, md: 'Первый\n\nВторой\n\nТретий (сосед)' })
    t.draft.setMd('Первый (я)\n\nВторой\n\nТретий')
    await t.draft.flush()

    expect(t.calls.map((c) => c.rev)).toEqual([1, 2])
    expect(t.server.page).toMatchObject({ rev: 3, md: 'Первый (я)\n\nВторой\n\nТретий (сосед)' })
    const s = t.draft.getState()
    expect(s).toMatchObject({ md: 'Первый (я)\n\nВторой\n\nТретий (сосед)', conflict: null })
    expect(s.resetKey, 'текст в редакторе заменился: он начинается заново').toBe(1)
    expect(t.draft.dirty).toBe(false)
    expect(t.deps.onError).not.toHaveBeenCalled()
  })

  it('оба дописали новый блок в конец: остаются оба, чужой выше, мой блок остаётся открытым', async () => {
    const t = setup(page({ md: three }))
    // я печатаю в новом блоке в конце (строка 6), курсор после четырёх букв
    t.draft.setActiveProbe(() => ({ start: 6, end: 7, caret: 4 }))
    t.server.page = page({ rev: 2, md: `${three}

Его` })
    t.draft.setMd(`${three}

Мой`)
    await t.draft.flush()

    expect(t.server.page).toMatchObject({ rev: 3, md: `${three}

Его

Мой` })
    expect(t.draft.getState()).toMatchObject({ conflict: null, md: `${three}

Его

Мой` })
    expect(t.draft.getState().restore, 'мой блок теперь ниже чужого').toEqual({ start: 8, end: 9, caret: 4 })
  })

  it('правки пересеклись: баннер, ничего не склеено и не сохранено', async () => {
    const t = setup(page({ md: three }))
    t.server.page = page({ rev: 2, md: 'Первый (сосед)\n\nВторой\n\nТретий' })
    t.draft.setMd('Первый (я)\n\nВторой\n\nТретий')
    await t.draft.flush()

    expect(t.draft.getState().conflict).toMatchObject({ rev: 2, md: 'Первый (сосед)\n\nВторой\n\nТретий' })
    expect(t.draft.getState()).toMatchObject({ md: 'Первый (я)\n\nВторой\n\nТретий', resetKey: 0 })
    expect(t.calls).toHaveLength(1)
  })

  it('мои правки уже есть в чужой версии: сохранять нечего', async () => {
    const t = setup(page({ md: three }))
    t.server.page = page({ rev: 2, md: 'Первый (общий)\n\nВторой\n\nТретий' })
    t.draft.setMd('Первый (общий)\n\nВторой\n\nТретий')
    await t.draft.flush()

    expect(t.calls).toHaveLength(1)
    expect(t.draft.getState()).toMatchObject({ conflict: null, md: 'Первый (общий)\n\nВторой\n\nТретий' })
    expect(t.draft.dirty).toBe(false)
  })

  it('название поменял только сосед, текст только я: оба на месте', async () => {
    const t = setup()
    t.server.page = page({ rev: 2, title: 'Новое название' })
    t.draft.setMd('Мой текст')
    await t.draft.flush()

    expect(t.calls.at(-1)).toEqual({ rev: 2, md: 'Мой текст' })
    expect(t.server.page).toMatchObject({ rev: 3, title: 'Новое название', md: 'Мой текст' })
    expect(t.draft.getState()).toMatchObject({ title: 'Новое название', md: 'Мой текст', conflict: null })
  })

  it('название поменял только я, текст только сосед: оба на месте', async () => {
    const t = setup()
    t.server.page = page({ rev: 2, md: 'Текст соседа' })
    t.draft.setTitle('Моё название')
    await t.draft.flush()

    expect(t.calls.at(-1)).toEqual({ rev: 2, title: 'Моё название' })
    expect(t.server.page).toMatchObject({ rev: 3, title: 'Моё название', md: 'Текст соседа' })
    expect(t.draft.getState().md).toBe('Текст соседа')
  })

  it('названия разошлись: баннер', async () => {
    const t = setup()
    t.server.page = page({ rev: 2, title: 'Название соседа' })
    t.draft.setTitle('Моё название')
    await t.draft.flush()
    expect(t.draft.getState().conflict).toMatchObject({ rev: 2 })
    expect(t.calls).toHaveLength(1)
  })

  it(`не больше ${MAX_MERGES} слияний подряд: потом баннер`, async () => {
    const calls: Body[] = []
    let n = 1
    const deps: DraftDeps = {
      // сосед успевает сохраниться между каждой моей попыткой
      patch: vi.fn(async (_id, body) => {
        calls.push(body)
        n++
        throw new ApiError(409, 'conflict', 'Страницу изменил другой участник', {
          code: 'conflict',
          current: page({ rev: n, md: `Первый

Второй

Третий ${n}` }),
        })
      }),
      onSaved: vi.fn(),
      onError: vi.fn(),
    }
    const draft = new PageDraft(page({ md: three }), deps)
    draft.setMd('Первый (я)\n\nВторой\n\nТретий')
    await draft.flush()

    expect(calls).toHaveLength(MAX_MERGES + 1)
    expect(draft.getState().conflict).toMatchObject({ rev: MAX_MERGES + 2 })
  })

  it('открытый блок и курсор переезжают вместе с текстом', async () => {
    const t = setup(page({ md: three }))
    // я печатаю в третьем абзаце (строка 4), курсор после трёх букв
    t.draft.setActiveProbe(() => ({ start: 4, end: 5, caret: 3 }))
    t.server.page = page({ rev: 2, md: 'Новый\n\nПервый\n\nВторой\n\nТретий' })
    t.draft.setMd('Первый\n\nВторой\n\nТретий (я)')
    await t.draft.flush()

    expect(t.draft.getState().md).toBe('Новый\n\nПервый\n\nВторой\n\nТретий (я)')
    expect(t.draft.getState().restore).toEqual({ start: 6, end: 7, caret: 3 })

    t.draft.clearRestore()
    expect(t.draft.getState().restore, 'редактор открыл блок: больше он не нужен').toBeNull()
  })

  it('редактор закрыт: восстанавливать нечего', async () => {
    const t = setup(page({ md: three }))
    t.draft.setActiveProbe(() => null)
    t.server.page = page({ rev: 2, md: 'Новый\n\nПервый\n\nВторой\n\nТретий' })
    t.draft.setMd('Первый\n\nВторой\n\nТретий (я)')
    await t.draft.flush()
    expect(t.draft.getState().restore).toBeNull()
    expect(t.draft.getState().resetKey).toBe(1)
  })

  it('«Загрузить его версию» после слияния не оставляет старый блок', async () => {
    const t = setup(page({ md: three }))
    t.draft.setActiveProbe(() => ({ start: 4, end: 5, caret: 0 }))
    t.server.page = page({ rev: 2, md: 'Новый\n\nПервый\n\nВторой\n\nТретий' })
    t.draft.setMd('Первый\n\nВторой\n\nТретий (я)')
    await t.draft.flush()
    expect(t.draft.getState().restore).not.toBeNull()

    // сосед и я правим одну и ту же строку: слить нельзя, человек берёт чужую версию
    t.server.page = page({ rev: 4, md: 'Новый\n\nПервый\n\nВторой\n\nТретий (сосед)' })
    t.draft.setMd('Новый\n\nПервый\n\nВторой\n\nТретий (я, ещё)')
    await t.draft.flush()
    expect(t.draft.getState().conflict).not.toBeNull()
    t.draft.acceptTheirs()
    expect(t.draft.getState().restore).toBeNull()
  })
})

describe('сбои сети', () => {
  it('при ошибке сообщает, оставляет текст и повторяет через 5 секунд', async () => {
    const t = setup()
    t.fail.next = new Error('нет связи')
    t.draft.setMd('Не потеряется')
    await t.draft.flush()
    expect(t.deps.onError).toHaveBeenCalledTimes(1)
    expect(t.draft.dirty).toBe(true)
    expect(t.draft.getState().md).toBe('Не потеряется')

    await vi.advanceTimersByTimeAsync(RETRY_MS)
    expect(t.calls).toHaveLength(2)
    expect(t.server.page.md).toBe('Не потеряется')
    expect(t.draft.dirty).toBe(false)
  })

  it('связи нет: плашки об ошибке нет, текст остаётся и уходит повтором', async () => {
    const t = setup()
    t.fail.next = new NetworkError('Нет связи с сервером')
    t.draft.setMd('Без связи')
    await t.draft.flush()
    expect(t.deps.onError).not.toHaveBeenCalled()
    expect(t.draft.dirty).toBe(true)
    expect(t.draft.getState().md).toBe('Без связи')

    await vi.advanceTimersByTimeAsync(RETRY_MS)
    expect(t.server.page.md).toBe('Без связи')
    expect(t.draft.dirty).toBe(false)
  })

  it('отказ записи в режиме «только просмотр» и ответ прокси (502) тоже тихие', async () => {
    const t = setup()
    t.fail.next = new OfflineError()
    t.draft.setMd('Один')
    await t.draft.flush()
    t.fail.next = new ApiError(502, 'error', 'Bad Gateway')
    await t.draft.flush()
    expect(t.deps.onError).not.toHaveBeenCalled()
    expect(t.draft.dirty).toBe(true)
    await t.draft.flush() // связь вернулась: следующая отправка проходит
    expect(t.server.page.md).toBe('Один')
  })

  it('другая ошибка сервера (не 409) тоже повторяется', async () => {
    const t = setup()
    t.fail.next = new ApiError(500, 'internal', 'Внутренняя ошибка сервера')
    t.draft.setMd('Текст')
    await t.draft.flush()
    expect(t.deps.onError).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(RETRY_MS)
    expect(t.server.page.md).toBe('Текст')
  })
})

describe('adopt: новая версия с сервера', () => {
  it('принимается, если своих правок нет', () => {
    const t = setup()
    t.draft.adopt(page({ rev: 3, md: 'Свежий текст', title: 'Свежее' }))
    expect(t.draft.getState()).toMatchObject({ md: 'Свежий текст', title: 'Свежее', conflict: null })
    expect(t.draft.getState().resetKey).toBe(1)
  })

  it('не затирает несохранённые правки', () => {
    const t = setup()
    t.draft.setMd('Мои правки')
    t.draft.adopt(page({ rev: 3, md: 'Свежий текст' }))
    expect(t.draft.getState().md).toBe('Мои правки')
  })

  it('старая или та же версия игнорируется', () => {
    const t = setup(page({ rev: 5 }))
    t.draft.adopt(page({ rev: 5, md: 'Другой' }))
    t.draft.adopt(page({ rev: 4, md: 'Старее' }))
    expect(t.draft.getState().md).toBe('Старый текст')
  })

  it('после принятой версии сохранение идёт с её номером', async () => {
    const t = setup()
    t.server.page = page({ rev: 3, md: 'Свежий' })
    t.draft.adopt(t.server.page)
    t.draft.setMd('Свежий и мой')
    await t.draft.flush()
    expect(t.calls).toEqual([{ rev: 3, md: 'Свежий и мой' }])
  })

  describe('открытый блок, пока чужая версия заменяет текст', () => {
    const three = 'Первый\n\nВторой\n\nТретий'
    // я стою курсором в третьем абзаце (строка 4) и ничего не набирал: своих правок нет
    const standing = (md = three) => {
      const t = setup(page({ md }))
      t.draft.setActiveProbe(() => ({ start: 4, end: 5, caret: 2 }))
      return t
    }

    it('чужой абзац выше: блок открывается на новом месте, курсор там же', () => {
      const t = standing()
      t.draft.adopt(page({ rev: 2, md: `Новый\n\n${three}` }))
      expect(t.draft.getState().md).toBe(`Новый\n\n${three}`)
      expect(t.draft.getState().restore).toEqual({ start: 6, end: 7, caret: 2 })
      expect(t.draft.getState().resetKey).toBe(1)
    })

    it('чужой абзац ниже: блок на месте', () => {
      const t = standing()
      t.draft.adopt(page({ rev: 2, md: `${three}\n\nНовый` }))
      expect(t.draft.getState().restore).toEqual({ start: 4, end: 5, caret: 2 })
    })

    it('сосед поправил именно мой блок: он остаётся открытым', () => {
      const t = standing()
      t.draft.adopt(page({ rev: 2, md: 'Первый\n\nВторой\n\nТретий (сосед)' }))
      expect(t.draft.getState().restore).toEqual({ start: 4, end: 5, caret: 2 })
    })

    it('сосед удалил мой блок: открывать нечего', () => {
      const t = standing()
      t.draft.adopt(page({ rev: 2, md: 'Первый\n\nВторой' }))
      expect(t.draft.getState().md).toBe('Первый\n\nВторой')
      expect(t.draft.getState().restore).toBeNull()
    })

    it('редактор закрыт: восстанавливать нечего', () => {
      const t = setup(page({ md: three }))
      t.draft.setActiveProbe(() => null)
      t.draft.adopt(page({ rev: 2, md: `Новый\n\n${three}` }))
      expect(t.draft.getState().restore).toBeNull()
      expect(t.draft.getState().resetKey).toBe(1)
    })

    it('текст не менялся (поменялось только название): редактор не пересоздаётся и блок не трогается', () => {
      const t = standing()
      t.draft.adopt(page({ rev: 2, md: three, title: 'Другое название' }))
      expect(t.draft.getState()).toMatchObject({ title: 'Другое название', resetKey: 0, restore: null })
    })

    it('когда редактор открыл блок, подсказка больше не нужна', () => {
      const t = standing()
      t.draft.adopt(page({ rev: 2, md: `Новый\n\n${three}` }))
      t.draft.clearRestore()
      expect(t.draft.getState().restore).toBeNull()
    })
  })
})

describe('подписка', () => {
  it('слушатели узнают о правках, снимок меняется только при изменении', () => {
    const t = setup()
    const listener = vi.fn()
    const off = t.draft.subscribe(listener)
    const before = t.draft.getState()
    t.draft.setMd('Старый текст')
    expect(listener).not.toHaveBeenCalled()
    expect(t.draft.getState()).toBe(before)
    t.draft.setMd('Новый')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(t.draft.getState()).not.toBe(before)
    off()
    t.draft.setMd('Ещё новее')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('dispose', () => {
  it('отменяет ждущее сохранение и повторы', async () => {
    const t = setup()
    t.draft.setMd('Не уйдёт')
    t.draft.dispose()
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2)
    await t.draft.flush()
    expect(t.calls).toHaveLength(0)
  })

  it('ответ на уже отправленное не запускает повтор', async () => {
    const t = setup()
    t.fail.next = new Error('нет связи')
    t.draft.setMd('Текст')
    await t.draft.flush()
    expect(t.deps.onError).toHaveBeenCalledTimes(1)
    t.draft.dispose()
    await vi.advanceTimersByTimeAsync(RETRY_MS * 2)
    expect(t.calls).toHaveLength(1)
  })
})
