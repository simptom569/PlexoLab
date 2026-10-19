import { describe, expect, it } from 'vitest'
import { DEFAULT_DISPLAY, DEFAULT_SETTINGS, EMPTY_FILTERS, parseSettings } from './settings'

describe('parseSettings', () => {
  it('пустое и мусор дают значения по умолчанию', () => {
    for (const raw of [undefined, null, {}, 'строка', 42, []]) {
      expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS)
    }
    expect(DEFAULT_SETTINGS).toEqual({
      serverUrl: null,
      lastEmail: '',
      theme: 'light',
      page: 'board',
      project: null,
      view: 'board',
      filters: EMPTY_FILTERS,
      display: DEFAULT_DISPLAY,
    })
  })

  it('сохраняет корректные значения', () => {
    const s = parseSettings({
      serverUrl: 'http://10.0.0.5:8080',
      lastEmail: 'lena@example.com',
      theme: 'dark',
      page: 'wiki',
      project: 'abc',
      view: 'gantt',
      filters: { who: ['u1', '-'], prio: ['high'], tag: ['t1'], module: ['-'], due: 'week' },
      display: { who: false, due: true, tags: false, prio: true, subs: true, pr: false, module: true },
    })
    expect(s.theme).toBe('dark')
    expect(s.view).toBe('gantt')
    expect(s.filters).toEqual({ who: ['u1', '-'], prio: ['high'], tag: ['t1'], module: ['-'], due: 'week' })
    expect(s.display.who).toBe(false)
    expect(s.display.pr).toBe(false)
  })

  it('испорченное поле заменяется, остальные остаются', () => {
    const s = parseSettings({
      serverUrl: 'http://x:1',
      theme: 'blue',
      view: 'cards',
      page: 'nope',
      filters: { who: 'не массив', prio: ['high', 'urgent'], due: 'tomorrow' },
      display: { who: 'да', due: false },
    })
    expect(s.serverUrl).toBe('http://x:1')
    expect(s.theme).toBe('light')
    expect(s.view).toBe('board')
    expect(s.page).toBe('board')
    expect(s.filters.who).toEqual([])
    expect(s.filters.due).toBe('any')
    expect(s.display.who).toBe(true)
    expect(s.display.due).toBe(false)
  })
})
