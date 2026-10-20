import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// сохранение на диск здесь не нужно: проверяем только состояние
vi.mock('./settings', async (importOriginal) => ({ ...(await importOriginal<typeof import('./settings')>()), saveSettings: vi.fn() }))

import { resolveDark, systemDark } from './theme'
import { useUi } from './ui-store'

describe('тема', () => {
  afterEach(() => vi.unstubAllGlobals())
  const systemIs = (dark: boolean) => vi.stubGlobal('matchMedia', () => ({ matches: dark }))

  it('быстрое переключение меняет светлую на тёмную и обратно', () => {
    useUi.setState({ theme: 'light' })
    useUi.getState().toggleTheme()
    expect(useUi.getState().theme).toBe('dark')
    useUi.getState().toggleTheme()
    expect(useUi.getState().theme).toBe('light')
  })

  it('«как в системе»: переключение идёт от того, что видно сейчас', () => {
    systemIs(true) // в системе тёмная: видна тёмная, значит переключаем на светлую
    useUi.setState({ theme: 'system' })
    useUi.getState().toggleTheme()
    expect(useUi.getState().theme).toBe('light')

    systemIs(false)
    useUi.setState({ theme: 'system' })
    useUi.getState().toggleTheme()
    expect(useUi.getState().theme).toBe('dark')
  })

  it('resolveDark: «как в системе» следует системе, остальное нет', () => {
    expect(resolveDark('system', true)).toBe(true)
    expect(resolveDark('system', false)).toBe(false)
    expect(resolveDark('light', true)).toBe(false)
    expect(resolveDark('dark', false)).toBe(true)
  })

  it('без браузера (matchMedia нет) система считается светлой', () => {
    expect(systemDark()).toBe(false)
  })
})

describe('настройки на этом компьютере', () => {
  it('режим полос, первый день недели и живые обновления меняются', () => {
    useUi.getState().setScrollbars('quiet')
    useUi.getState().setWeekStart('sun')
    useUi.getState().setLive(false)
    expect(useUi.getState()).toMatchObject({ scrollbars: 'quiet', weekStart: 'sun', live: false })
    useUi.getState().setTheme('system')
    expect(useUi.getState().theme).toBe('system')
  })
})

describe('окно настроек', () => {
  beforeEach(() => useUi.setState({ settingsTab: null, menu: null }))

  it('по умолчанию закрыто', () => {
    expect(useUi.getState().settingsTab).toBeNull()
  })

  it('открывается на «Аккаунте» и закрывает меню пользователя', () => {
    useUi.setState({ menu: 'user' })
    useUi.getState().openSettings()
    expect(useUi.getState()).toMatchObject({ settingsTab: 'account', menu: null })
  })

  it('открывается на указанной категории', () => {
    useUi.getState().openSettings('server')
    expect(useUi.getState().settingsTab).toBe('server')
  })

  it('переключает категорию и закрывается', () => {
    useUi.getState().openSettings()
    useUi.getState().setSettingsTab('about')
    expect(useUi.getState().settingsTab).toBe('about')
    useUi.getState().closeSettings()
    expect(useUi.getState().settingsTab).toBeNull()
  })
})
