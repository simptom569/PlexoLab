import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasObject, SavedCanvas } from '../../lib/api/types'
import { addObject, moveNote, patchObject, type CanvasState } from './canvas'
import { CANVAS_RETRY_MS, CANVAS_SAVE_DELAY_MS, CanvasDraft, type CanvasDraftDeps, type ServerCanvas } from './canvasDraft'

const obj = (id: string, x = 10, y = 10): CanvasObject => ({ id, type: 'rect', x, y, w: 100, h: 60, text: id, color: 3 })

const serverCanvas = (o: Partial<ServerCanvas> = {}): ServerCanvas => ({
  canvas_rev: 1,
  note: { x: 24, y: 28, w: 400 },
  objects: [obj('a')],
  links: [],
  ...o,
})

function setup(initial: ServerCanvas = serverCanvas()) {
  const server = { rev: initial.canvas_rev }
  const calls: CanvasState[] = []
  let gate: Promise<void> | null = null
  const fail = { next: false }
  const deps: CanvasDraftDeps = {
    put: vi.fn(async (_id, canvas) => {
      calls.push(canvas)
      if (gate) await gate
      if (fail.next) {
        fail.next = false
        throw new Error('нет связи')
      }
      server.rev++
      return { canvas_rev: server.rev, ...canvas } satisfies SavedCanvas
    }),
    onSaved: vi.fn(),
    onError: vi.fn(),
  }
  const draft = new CanvasDraft('d1', initial, deps)
  return {
    draft,
    deps,
    calls,
    server,
    fail,
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

describe('сохранение', () => {
  it('правка уходит на сервер через 600 мс; серия правок даёт один запрос с последним состоянием', async () => {
    const t = setup()
    t.draft.change((s) => patchObject(s, 'a', { text: 'Н' }))
    await vi.advanceTimersByTimeAsync(CANVAS_SAVE_DELAY_MS - 1)
    t.draft.change((s) => patchObject(s, 'a', { text: 'Новый' }))
    await vi.advanceTimersByTimeAsync(CANVAS_SAVE_DELAY_MS - 1)
    expect(t.calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(t.calls).toHaveLength(1)
    expect(t.calls[0]!.objects[0]!.text).toBe('Новый')
    expect(t.draft.dirty).toBe(false)
    expect(t.deps.onSaved).toHaveBeenCalledWith('d1', expect.objectContaining({ canvas_rev: 2 }))
  })

  it('пока объект тащат, ничего не уходит, по commit уходит сразу и целиком', async () => {
    const t = setup()
    for (const x of [20, 40, 60, 80]) t.draft.change((s) => patchObject(s, 'a', { x }), { save: false })
    await vi.advanceTimersByTimeAsync(CANVAS_SAVE_DELAY_MS * 5)
    expect(t.calls).toHaveLength(0)
    expect(t.draft.dirty).toBe(true)
    expect(t.draft.getState().objects[0]!.x).toBe(80)

    t.draft.commit()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.calls).toHaveLength(1)
    expect(t.calls[0]!.objects[0]!.x).toBe(80)
    expect(t.draft.dirty).toBe(false)
  })

  it('карточка с текстом двигается и сохраняется вместе с холстом', async () => {
    const t = setup()
    t.draft.change((s) => moveNote(s, 90, 70), { save: false })
    t.draft.commit()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.calls[0]!.note).toEqual({ x: 90, y: 70, w: 400 })
  })

  it('правка, которая ничего не меняет, не сохраняется', async () => {
    const t = setup()
    t.draft.change((s) => patchObject(s, 'a', { x: 10 }))
    t.draft.commit()
    await vi.advanceTimersByTimeAsync(CANVAS_SAVE_DELAY_MS * 2)
    expect(t.calls).toHaveLength(0)
    expect(t.draft.dirty).toBe(false)
  })

  it('правки во время отправки уходят следующим запросом после ответа, ничего не теряется', async () => {
    const t = setup()
    const release = t.hold()
    t.draft.change((s) => addObject(s, obj('b', 200, 20)))
    t.draft.commit()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.calls).toHaveLength(1)

    t.draft.change((s) => addObject(s, obj('c', 300, 20)), { save: false })
    t.draft.commit() // идёт отправка: запрос не удваивается
    await vi.advanceTimersByTimeAsync(0)
    expect(t.calls).toHaveLength(1)

    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.calls).toHaveLength(2)
    expect(t.calls[1]!.objects.map((o) => o.id)).toEqual(['a', 'b', 'c'])
    expect(t.draft.dirty).toBe(false)
  })

  it('flush отправляет сразу, не дожидаясь паузы', async () => {
    const t = setup()
    t.draft.change((s) => patchObject(s, 'a', { color: 5 }))
    await t.draft.flush()
    expect(t.calls).toHaveLength(1)
  })
})

describe('сбой сети', () => {
  it('сообщает об ошибке, повторяет через 5 секунд и не теряет правку', async () => {
    const t = setup()
    t.fail.next = true
    t.draft.change((s) => patchObject(s, 'a', { x: 77 }))
    await vi.advanceTimersByTimeAsync(CANVAS_SAVE_DELAY_MS)
    expect(t.deps.onError).toHaveBeenCalledTimes(1)
    expect(t.draft.dirty).toBe(true)
    expect(t.draft.getState().objects[0]!.x).toBe(77)

    await vi.advanceTimersByTimeAsync(CANVAS_RETRY_MS)
    expect(t.calls).toHaveLength(2)
    expect(t.draft.dirty).toBe(false)
  })

  it('удалённый документ не получает повторов', async () => {
    const t = setup()
    t.fail.next = true
    t.draft.change((s) => patchObject(s, 'a', { x: 5 }))
    await vi.advanceTimersByTimeAsync(CANVAS_SAVE_DELAY_MS)
    t.draft.dispose()
    await vi.advanceTimersByTimeAsync(CANVAS_RETRY_MS * 3)
    expect(t.calls).toHaveLength(1)
  })
})

describe('состояние с сервера', () => {
  it('новая версия принимается, пока своих правок нет', () => {
    const t = setup()
    const seen = vi.fn()
    t.draft.subscribe(seen)
    t.draft.adopt(serverCanvas({ canvas_rev: 2, objects: [obj('a'), obj('чужой', 300, 0)] }))
    expect(t.draft.getState().objects.map((o) => o.id)).toEqual(['a', 'чужой'])
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('та же или более старая версия игнорируется: запоздавший ответ не откатывает холст', async () => {
    const t = setup()
    t.draft.change((s) => patchObject(s, 'a', { x: 99 }))
    await t.draft.flush() // версия 2
    t.draft.adopt(serverCanvas({ canvas_rev: 1, objects: [obj('a', 10, 10)] }))
    t.draft.adopt(serverCanvas({ canvas_rev: 2, objects: [obj('a', 10, 10)] }))
    expect(t.draft.getState().objects[0]!.x).toBe(99)
  })

  it('пока есть несохранённые правки или идёт отправка, чужая версия не принимается', async () => {
    const t = setup()
    t.draft.change((s) => patchObject(s, 'a', { x: 50 }), { save: false })
    t.draft.adopt(serverCanvas({ canvas_rev: 5, objects: [obj('чужой')] }))
    expect(t.draft.getState().objects[0]!.id).toBe('a')

    const release = t.hold()
    t.draft.commit()
    await vi.advanceTimersByTimeAsync(0)
    t.draft.adopt(serverCanvas({ canvas_rev: 6, objects: [obj('чужой')] }))
    expect(t.draft.getState().objects[0]!.id).toBe('a')
    release()
    await vi.advanceTimersByTimeAsync(0)
  })

  it('своя же версия после сохранения ничего не перерисовывает', async () => {
    const t = setup()
    t.draft.change((s) => patchObject(s, 'a', { x: 12 }))
    await t.draft.flush()
    const seen = vi.fn()
    t.draft.subscribe(seen)
    t.draft.adopt(serverCanvas({ canvas_rev: 2, objects: [obj('a', 12, 10)] }))
    expect(seen).not.toHaveBeenCalled()
  })
})
