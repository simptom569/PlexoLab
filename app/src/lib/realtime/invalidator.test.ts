import type { QueryKey } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BATCH_MS, dedupe, Invalidator, MAX_WAIT_MS, RETRY_MS } from './invalidator'

describe('dedupe', () => {
  it('повторы схлопываются', () => {
    expect(dedupe([['board', 'p1'], ['board', 'p1'], ['wiki']])).toEqual([['board', 'p1'], ['wiki']])
  })

  it('более короткий ключ покрывает длинные: [board] покрывает [board, p1]', () => {
    expect(dedupe([['board', 'p1'], ['board'], ['board', 'p2']])).toEqual([['board']])
  })

  it('пустой ключ покрывает всё', () => {
    expect(dedupe([['board', 'p1'], [], ['wiki'], ['docs', 'search', 'x']])).toEqual([[]])
  })

  it('похожие, но разные ключи остаются', () => {
    expect(dedupe([['task'], ['tasks'], ['task', 't1']])).toEqual([['task'], ['tasks']])
  })
})

describe('Invalidator', () => {
  let calls: QueryKey[]
  let busy = false
  let invalidator: Invalidator

  beforeEach(() => {
    vi.useFakeTimers()
    calls = []
    busy = false
    invalidator = new Invalidator({ invalidateQueries: ({ queryKey }) => Promise.resolve(void calls.push(queryKey)) }, () => busy)
  })
  afterEach(() => {
    invalidator.clear()
    vi.useRealTimers()
  })

  it('копит ключи короткое время и перечитывает одним разом без повторов', () => {
    invalidator.add([['board', 'p1'], ['task', 't1']])
    invalidator.add([['activity']])
    invalidator.add([['task', 't1']])
    expect(calls).toEqual([])
    vi.advanceTimersByTime(BATCH_MS - 1)
    expect(calls).toEqual([])
    vi.advanceTimersByTime(1)
    expect(calls).toEqual([['board', 'p1'], ['task', 't1'], ['activity']])
  })

  it('пустой список ничего не планирует', () => {
    invalidator.add([])
    vi.advanceTimersByTime(10_000)
    expect(calls).toEqual([])
  })

  it('после перечитывания следующие события снова копятся отдельно', () => {
    invalidator.add([['a']])
    vi.advanceTimersByTime(BATCH_MS)
    invalidator.add([['b']])
    vi.advanceTimersByTime(BATCH_MS)
    expect(calls).toEqual([['a'], ['b']])
  })

  it('пока экран занят (своя правка, перенос карточки), перечитывание ждёт', () => {
    busy = true
    invalidator.add([['board', 'p1']])
    vi.advanceTimersByTime(BATCH_MS + RETRY_MS * 4)
    expect(calls).toEqual([])
    busy = false
    vi.advanceTimersByTime(RETRY_MS)
    expect(calls).toEqual([['board', 'p1']])
  })

  it('события, пришедшие во время ожидания, присоединяются к тому же перечитыванию', () => {
    busy = true
    invalidator.add([['a']])
    vi.advanceTimersByTime(BATCH_MS + RETRY_MS)
    invalidator.add([['b']])
    busy = false
    vi.advanceTimersByTime(RETRY_MS)
    expect(calls).toEqual([['a'], ['b']])
  })

  it('ждать вечно не будет: долгая загрузка файла не замораживает чужие изменения', () => {
    busy = true
    invalidator.add([['board', 'p1']])
    vi.advanceTimersByTime(BATCH_MS + MAX_WAIT_MS - RETRY_MS)
    expect(calls).toEqual([])
    vi.advanceTimersByTime(RETRY_MS * 2)
    expect(calls).toEqual([['board', 'p1']])
  })

  it('clear отменяет всё ожидающее', () => {
    invalidator.add([['a']])
    invalidator.clear()
    vi.advanceTimersByTime(10_000)
    expect(calls).toEqual([])
    invalidator.add([['b']]) // и дальше работает
    vi.advanceTimersByTime(BATCH_MS)
    expect(calls).toEqual([['b']])
  })

  it('«все запросы» перекрывают остальные', () => {
    invalidator.add([['board', 'p1']])
    invalidator.add([[]])
    vi.advanceTimersByTime(BATCH_MS)
    expect(calls).toEqual([[]])
  })
})
