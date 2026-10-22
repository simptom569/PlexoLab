import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSettings, saveSettings } from '../../lib/settings'
import { MAX_REMEMBERED_VIEWS, rememberView, rememberedView } from './views'

// запись на диск в тестах без браузера сообщает об ошибке и этим не интересна
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  saveSettings({ canvasViews: {} })
})
afterEach(() => vi.restoreAllMocks())

describe('вид холста по документам', () => {
  it('запомненное возвращается, остальное null', () => {
    expect(rememberedView('a')).toBeNull()
    rememberView('a', { x: -120.4, y: 30.6, z: 1.2345 })
    expect(rememberedView('a')).toEqual({ x: -120, y: 31, z: 1.235 })
    expect(rememberedView('b')).toBeNull()
  })

  it('начальное положение не хранится и стирает прежнюю запись', () => {
    rememberView('a', { x: 50, y: 0, z: 1 })
    expect(rememberedView('a')).not.toBeNull()
    rememberView('a', { x: 0, y: 0, z: 1 })
    expect(rememberedView('a')).toBeNull()
    expect(getSettings().canvasViews).toEqual({})
  })

  it('масштаб из настроек держится в допустимых пределах', () => {
    saveSettings({ canvasViews: { a: { x: 0, y: 0, z: 9 }, b: { x: 0, y: 0, z: 0.01 } } })
    expect(rememberedView('a')?.z).toBe(2)
    expect(rememberedView('b')?.z).toBe(0.25)
  })

  it('помнит не больше ста документов, вытесняются самые давние', () => {
    for (let i = 0; i < MAX_REMEMBERED_VIEWS + 5; i++) rememberView(`d${i}`, { x: i + 1, y: 0, z: 1 })
    const ids = Object.keys(getSettings().canvasViews)
    expect(ids).toHaveLength(MAX_REMEMBERED_VIEWS)
    expect(rememberedView('d0')).toBeNull()
    expect(rememberedView(`d${MAX_REMEMBERED_VIEWS + 4}`)).not.toBeNull()
  })

  it('повторно открытый документ идёт в конец очереди и не вытесняется первым', () => {
    for (let i = 0; i < MAX_REMEMBERED_VIEWS; i++) rememberView(`d${i}`, { x: i + 1, y: 0, z: 1 })
    rememberView('d0', { x: 999, y: 0, z: 1 }) // самый давний снова в деле
    rememberView('new', { x: 5, y: 5, z: 1 })
    expect(rememberedView('d0')).not.toBeNull()
    expect(rememberedView('d1')).toBeNull()
  })

  it('то же самое значение диск не трогает', () => {
    rememberView('a', { x: 7, y: 7, z: 1 })
    // у saveSettings нет подписки: проверяем по тому, что объект записей остался тем же
    const before = getSettings().canvasViews
    rememberView('a', { x: 7.2, y: 6.9, z: 1 })
    expect(getSettings().canvasViews).toBe(before)
  })
})
