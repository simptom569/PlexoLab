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
      scrollbars: 'visible',
      weekStart: 'mon',
      live: true,
      presence: true,
      page: 'board',
      project: null,
      team: null,
      view: 'board',
      filters: EMPTY_FILTERS,
      display: DEFAULT_DISPLAY,
      wikiPage: null,
      docOpen: null,
      docStar: false,
      canvasViews: {},
      actWho: 'all',
      actKind: 'all',
    })
  })

  it('тема «как в системе», полосы прокрутки, первый день недели и живые обновления хранятся', () => {
    const s = parseSettings({ theme: 'system', scrollbars: 'quiet', weekStart: 'sun', live: false })
    expect(s).toMatchObject({ theme: 'system', scrollbars: 'quiet', weekStart: 'sun', live: false })
  })

  it('мусор в этих настройках заменяется значением по умолчанию', () => {
    const s = parseSettings({ theme: 'auto', scrollbars: 'thin', weekStart: 'tue', live: 'yes' })
    expect(s).toMatchObject({ theme: 'light', scrollbars: 'visible', weekStart: 'mon', live: true })
  })

  it('«Показывать, где правят другие» по умолчанию включено, выключенное хранится, мусор заменяется на «включено»', () => {
    expect(parseSettings({}).presence).toBe(true)
    expect(parseSettings({ presence: false }).presence).toBe(false)
    expect(parseSettings({ presence: 'нет' }).presence).toBe(true)
  })

  it('вид холста по документам хранится; мусор не ломает остальные записи', () => {
    const good = { x: -40, y: 12, z: 1.25 }
    expect(parseSettings({ canvasViews: { a: good } }).canvasViews).toEqual({ a: good })
    expect(parseSettings({ canvasViews: { a: good, b: { x: 'много', y: 0, z: 1 }, c: null } }).canvasViews).toEqual({ a: good, b: null, c: null })
    expect(parseSettings({ canvasViews: 'мусор' }).canvasViews).toEqual({})
    expect(parseSettings({ canvasViews: { a: { x: Infinity, y: 0, z: 1 } } }).canvasViews).toEqual({ a: null })
  })

  it('фильтры ленты активности хранятся, мусор заменяется на «все»', () => {
    expect(parseSettings({ actWho: 'u1', actKind: 'module' })).toMatchObject({ actWho: 'u1', actKind: 'module' })
    expect(parseSettings({ actWho: 5, actKind: 'moves' })).toMatchObject({ actWho: 'all', actKind: 'all' })
  })

  it('последняя страница вики хранится строкой, мусор заменяется на null', () => {
    expect(parseSettings({ wikiPage: 'w4' }).wikiPage).toBe('w4')
    expect(parseSettings({ wikiPage: 7 }).wikiPage).toBeNull()
  })

  it('открытый документ и фильтр «Избранные» хранятся, мусор заменяется', () => {
    expect(parseSettings({ docOpen: 'd1', docStar: true })).toMatchObject({ docOpen: 'd1', docStar: true })
    expect(parseSettings({ docOpen: 5, docStar: 'да' })).toMatchObject({ docOpen: null, docStar: false })
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
