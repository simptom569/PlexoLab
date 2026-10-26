import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { linkLost, linkRestored, resetLink, setLinkProbe } from './link'
import { flushUnsent, trackUnsent, unsentCount, untrackUnsent, type Unsent } from './unsent'

/** Черновик на минималках: `dirty` и `flush`, который, как настоящий, сохраняет правку */
function draft(dirty: boolean) {
  const d = {
    dirty,
    flush: vi.fn(async () => {
      d.dirty = false
    }),
  }
  return d satisfies Unsent
}

const tracked: Unsent[] = []
const track = (d: Unsent) => {
  trackUnsent(d)
  tracked.push(d)
  return d
}

beforeEach(() => {
  vi.useFakeTimers()
  setLinkProbe(async () => false)
  resetLink()
})

afterEach(() => {
  for (const d of tracked.splice(0)) untrackUnsent(d)
  resetLink()
  vi.useRealTimers()
})

describe('учёт несохранённого', () => {
  it('считает только те черновики, где есть что отправлять', () => {
    track(draft(true))
    track(draft(false))
    track(draft(true))
    expect(unsentCount()).toBe(2)
  })

  it('черновик, за которым перестали следить, не считается', () => {
    const d = track(draft(true))
    untrackUnsent(d)
    expect(unsentCount()).toBe(0)
  })

  it('flushUnsent отправляет только то, что не сохранено, и ждёт всех', async () => {
    const dirty = track(draft(true)) as ReturnType<typeof draft>
    const clean = track(draft(false)) as ReturnType<typeof draft>
    await flushUnsent()
    expect(dirty.flush).toHaveBeenCalledTimes(1)
    expect(clean.flush).not.toHaveBeenCalled()
    expect(unsentCount()).toBe(0)
  })

  it('сбой одного черновика не мешает остальным', async () => {
    const broken = track({ dirty: true, flush: vi.fn(async () => Promise.reject(new Error('boom'))) })
    const fine = track(draft(true)) as ReturnType<typeof draft>
    await expect(flushUnsent()).resolves.toBeUndefined()
    expect(broken.flush).toHaveBeenCalled()
    expect(fine.flush).toHaveBeenCalled()
  })
})

describe('возвращение связи', () => {
  it('накопленное уходит сразу, как только связь вернулась', async () => {
    const d = track(draft(true)) as ReturnType<typeof draft>
    linkLost()
    expect(d.flush).not.toHaveBeenCalled()
    linkRestored()
    await vi.advanceTimersByTimeAsync(0)
    expect(d.flush).toHaveBeenCalledTimes(1)
  })
})
