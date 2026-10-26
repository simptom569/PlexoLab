import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FIRST_PROBE_MS,
  PROBE_EVERY_MS,
  READ_ONLY_AFTER_MS,
  linkLost,
  linkRestored,
  onLinkRestored,
  probeLinkNow,
  resetLink,
  setLinkProbe,
  useLink,
} from './link'

const state = () => useLink.getState()
const probe = vi.fn<() => Promise<boolean>>()

beforeEach(() => {
  vi.useFakeTimers()
  probe.mockReset()
  probe.mockResolvedValue(false)
  setLinkProbe(probe)
  resetLink()
})

afterEach(() => {
  resetLink()
  vi.useRealTimers()
})

describe('режим «только просмотр»', () => {
  it('включается не сразу, а когда связи нет три секунды подряд', async () => {
    linkLost()
    expect(state()).toEqual({ down: true, readOnly: false })
    await vi.advanceTimersByTimeAsync(READ_ONLY_AFTER_MS - 1)
    expect(state().readOnly).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(state()).toEqual({ down: true, readOnly: true })
  })

  it('короткий сбой, который проверка видит как прошедший, до просмотра не доходит', async () => {
    probe.mockResolvedValue(true)
    linkLost()
    await vi.advanceTimersByTimeAsync(FIRST_PROBE_MS)
    expect(state()).toEqual({ down: false, readOnly: false })
    await vi.advanceTimersByTimeAsync(READ_ONLY_AFTER_MS * 2)
    expect(state().readOnly).toBe(false)
  })

  it('выключается сразу, как связь вернулась', async () => {
    linkLost()
    await vi.advanceTimersByTimeAsync(READ_ONLY_AFTER_MS)
    expect(state().readOnly).toBe(true)
    linkRestored()
    expect(state()).toEqual({ down: false, readOnly: false })
  })

  it('повторная потеря связи не сдвигает таймер', async () => {
    linkLost()
    await vi.advanceTimersByTimeAsync(2_000)
    linkLost()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(state().readOnly).toBe(true)
  })
})

describe('проверка связи', () => {
  it('первая проверка через секунду, дальше каждые четыре, пока сервер не ответил', async () => {
    linkLost()
    await vi.advanceTimersByTimeAsync(FIRST_PROBE_MS - 1)
    expect(probe).toHaveBeenCalledTimes(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(probe).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(PROBE_EVERY_MS)
    expect(probe).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(PROBE_EVERY_MS)
    expect(probe).toHaveBeenCalledTimes(3)
  })

  it('когда сервер ответил, связь возвращается и проверки прекращаются', async () => {
    probe.mockResolvedValueOnce(false).mockResolvedValue(true)
    linkLost()
    await vi.advanceTimersByTimeAsync(FIRST_PROBE_MS + PROBE_EVERY_MS)
    expect(state().down).toBe(false)
    const calls = probe.mock.calls.length
    await vi.advanceTimersByTimeAsync(PROBE_EVERY_MS * 3)
    expect(probe).toHaveBeenCalledTimes(calls)
  })

  it('ошибка самой проверки считается «связи нет»', async () => {
    probe.mockRejectedValue(new Error('boom'))
    linkLost()
    await vi.advanceTimersByTimeAsync(FIRST_PROBE_MS)
    expect(state().down).toBe(true)
    await vi.advanceTimersByTimeAsync(PROBE_EVERY_MS)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('«проверить сейчас» не ждёт паузы, и две проверки разом не идут', async () => {
    let finish: (ok: boolean) => void = () => undefined
    probe.mockImplementation(() => new Promise<boolean>((resolve) => (finish = resolve)))
    linkLost()
    probeLinkNow()
    probeLinkNow()
    expect(probe).toHaveBeenCalledTimes(1)
    finish(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(state().down).toBe(false)
  })

  it('без потери связи проверять нечего', () => {
    probeLinkNow()
    expect(probe).not.toHaveBeenCalled()
  })
})

describe('возвращение связи', () => {
  it('сообщается подписчикам один раз', () => {
    const listener = vi.fn()
    const off = onLinkRestored(listener)
    linkRestored() // связи и не было
    expect(listener).not.toHaveBeenCalled()
    linkLost()
    linkRestored()
    linkRestored()
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    linkLost()
    linkRestored()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('сброс забывает всё и останавливает таймеры', async () => {
    linkLost()
    resetLink()
    await vi.advanceTimersByTimeAsync(READ_ONLY_AFTER_MS * 2)
    expect(state()).toEqual({ down: false, readOnly: false })
    expect(probe).not.toHaveBeenCalled()
  })
})
