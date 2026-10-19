import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/api/client'
import type { WikiPage } from '../../lib/api/types'
import { PageDraft, RETRY_MS, SAVE_DELAY_MS, type DraftDeps } from './draft'

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
function setup(initial: WikiPage = page()) {
  const server = { page: initial }
  const calls: Body[] = []
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
  }
  const draft = new PageDraft(initial, deps)
  return {
    draft,
    deps,
    calls,
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
