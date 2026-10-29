import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCloseAsk } from './closeAsk'
import { CLOSE_WAIT_MS, guardUnload, handleCloseRequest, handleTrayQuit, handleWindowClose, type CloseDeps } from './closeGuard'
import { trackUnsent, untrackUnsent, type Unsent } from './unsent'

/** Окружение закрытия на минималках: сколько черновиков не сохранено, что будет после отправки, что ответит человек */
function setup({ unsent = 1, flushed = true, answer = true }: { unsent?: number; flushed?: boolean; answer?: boolean } = {}) {
  const state = { unsent }
  const deps: CloseDeps = {
    unsentCount: () => state.unsent,
    flushUnsent: vi.fn(async () => {
      if (flushed) state.unsent = 0
    }),
    ask: vi.fn(async () => answer),
    wait: vi.fn((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
  }
  return { deps, state }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('handleWindowClose (крестик на окне)', () => {
  it('«Сворачивать в трей» включено: прячет в трей, не отправляя и не спрашивая', async () => {
    const { deps } = setup({ unsent: 3, flushed: false })
    expect(await handleWindowClose(true, deps)).toBe('hide')
    expect(deps.flushUnsent).not.toHaveBeenCalled()
    expect(deps.ask).not.toHaveBeenCalled()
  })

  it('выключено, нечего терять: закрывается', async () => {
    const { deps } = setup({ unsent: 0 })
    expect(await handleWindowClose(false, deps)).toBe('close')
  })

  it('выключено, есть неотправленное и связи нет: спрашивает', async () => {
    const { deps } = setup({ flushed: false, answer: false })
    const result = handleWindowClose(false, deps)
    await vi.advanceTimersByTimeAsync(CLOSE_WAIT_MS)
    expect(await result).toBe('stay')
    expect(deps.ask).toHaveBeenCalledTimes(1)
  })
})

describe('handleTrayQuit («Выйти» в меню трея)', () => {
  it('нечего терять: выходит, окно не показывает', async () => {
    const { deps } = setup({ unsent: 0 })
    const reveal = vi.fn(async () => undefined)
    expect(await handleTrayQuit(reveal, deps)).toBe('close')
    expect(reveal).not.toHaveBeenCalled()
  })

  it('есть неотправленное: сначала показывает окно (вопрос задаётся в нём), потом отправляет', async () => {
    const { deps } = setup({ flushed: true })
    const order: string[] = []
    const reveal = vi.fn(async () => void order.push('окно'))
    deps.flushUnsent = vi.fn(async () => void order.push('отправка'))
    deps.unsentCount = vi.fn(() => (order.includes('отправка') ? 0 : 1))
    expect(await handleTrayQuit(reveal, deps)).toBe('close')
    expect(order).toEqual(['окно', 'отправка'])
  })

  it('не ушло и человек ответил «остаться»: приложение работает дальше', async () => {
    const { deps } = setup({ flushed: false, answer: false })
    const result = handleTrayQuit(async () => undefined, deps)
    await vi.advanceTimersByTimeAsync(CLOSE_WAIT_MS)
    expect(await result).toBe('stay')
  })
})

describe('handleCloseRequest', () => {
  it('нечего терять: закрывается сразу, без отправки и без вопроса', async () => {
    const { deps } = setup({ unsent: 0 })
    expect(await handleCloseRequest(deps)).toBe('close')
    expect(deps.flushUnsent).not.toHaveBeenCalled()
    expect(deps.ask).not.toHaveBeenCalled()
  })

  it('неотправленное ушло вовремя: закрывается без вопроса', async () => {
    const { deps } = setup({ flushed: true })
    expect(await handleCloseRequest(deps)).toBe('close')
    expect(deps.flushUnsent).toHaveBeenCalledTimes(1)
    expect(deps.ask).not.toHaveBeenCalled()
  })

  it('не ушло (нет связи): спрашивает, и ответ «закрыть» закрывает', async () => {
    const { deps } = setup({ flushed: false, answer: true })
    const result = handleCloseRequest(deps)
    await vi.advanceTimersByTimeAsync(CLOSE_WAIT_MS)
    expect(await result).toBe('close')
    expect(deps.ask).toHaveBeenCalledTimes(1)
  })

  it('ответ «остаться» оставляет окно открытым', async () => {
    const { deps } = setup({ flushed: false, answer: false })
    const result = handleCloseRequest(deps)
    await vi.advanceTimersByTimeAsync(CLOSE_WAIT_MS)
    expect(await result).toBe('stay')
  })

  it('отправка зависла: ждёт не больше двух секунд и спрашивает', async () => {
    const { deps } = setup({ answer: false })
    deps.flushUnsent = vi.fn(() => new Promise<void>(() => undefined)) // ответа нет никогда
    const result = handleCloseRequest(deps)
    await vi.advanceTimersByTimeAsync(CLOSE_WAIT_MS - 1)
    expect(deps.ask).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toBe('stay')
    expect(deps.ask).toHaveBeenCalledTimes(1)
  })

  it('сбой отправки не мешает спросить', async () => {
    const { deps } = setup({ answer: true })
    deps.flushUnsent = vi.fn(async () => Promise.reject(new Error('boom')))
    const result = handleCloseRequest(deps)
    await vi.advanceTimersByTimeAsync(0)
    expect(await result).toBe('close')
    expect(deps.ask).toHaveBeenCalled()
  })

  it('отправка успела за секунду: не ждёт две секунды до конца', async () => {
    const { deps, state } = setup({ answer: false })
    deps.flushUnsent = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      state.unsent = 0
    })
    const result = handleCloseRequest(deps)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await result).toBe('close')
    expect(deps.ask).not.toHaveBeenCalled()
  })
})

describe('guardUnload (браузер)', () => {
  it('есть несохранённое: просит подтверждение у браузера', () => {
    const event = { preventDefault: vi.fn(), returnValue: undefined as unknown }
    guardUnload(event, 2)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.returnValue).toBe('')
  })

  it('нечего терять: закрытие не трогается', () => {
    const event = { preventDefault: vi.fn(), returnValue: undefined as unknown }
    guardUnload(event, 0)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.returnValue).toBeUndefined()
  })

  it('считает настоящие черновики с несохранённым', () => {
    const d: Unsent = { dirty: true, flush: vi.fn(async () => undefined) }
    trackUnsent(d)
    const event = { preventDefault: vi.fn(), returnValue: undefined as unknown }
    guardUnload(event)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(d.flush).toHaveBeenCalled() // вдруг успеет, пока человек читает вопрос
    untrackUnsent(d)
  })
})

describe('вопрос человеку', () => {
  afterEach(() => useCloseAsk.getState().answer(false))

  it('окно открывается на вопрос, ответ возвращается тому, кто спрашивал', async () => {
    const asked = useCloseAsk.getState().ask()
    expect(useCloseAsk.getState().open).toBe(true)
    useCloseAsk.getState().answer(true)
    expect(await asked).toBe(true)
    expect(useCloseAsk.getState().open).toBe(false)
  })

  it('закрыть окно вопроса значит «остаться»', async () => {
    const asked = useCloseAsk.getState().ask()
    useCloseAsk.getState().answer(false)
    expect(await asked).toBe(false)
  })

  it('второй вопрос подряд получает тот же ответ, что и первый', async () => {
    const first = useCloseAsk.getState().ask()
    const second = useCloseAsk.getState().ask()
    useCloseAsk.getState().answer(true)
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(useCloseAsk.getState().open).toBe(false)
  })
})
