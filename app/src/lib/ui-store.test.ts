import { beforeEach, describe, expect, it, vi } from 'vitest'

// сохранение на диск здесь не нужно: проверяем только состояние
vi.mock('./settings', async (importOriginal) => ({ ...(await importOriginal<typeof import('./settings')>()), saveSettings: vi.fn() }))

import { useUi } from './ui-store'

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
