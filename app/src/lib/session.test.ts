import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TokenResponse } from './api/types'

// Всё, что снаружи, подменяем: сеть, хранилище токенов, файл настроек.
// vi.hoisted нужен потому, что vi.mock выполняется раньше остального кода файла.
const mocks = vi.hoisted(() => ({
  authApi: { login: vi.fn(), refresh: vi.fn(), logout: vi.fn(), findServer: vi.fn() },
  httpFetch: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
  vault: new Map<string, string>(),
  settings: { serverUrl: null as string | null, lastEmail: '' },
  saveSettings: vi.fn(),
}))
const { authApi, httpFetch, vault, saveSettings } = mocks

vi.mock('./api/auth', () => mocks.authApi)
vi.mock('./platform/http', () => ({ httpFetch: mocks.httpFetch, NetworkError: class NetworkError extends Error {} }))
vi.mock('./platform/secrets', () => ({
  getRefreshToken: async (server: string) => mocks.vault.get(server) ?? null,
  setRefreshToken: async (server: string, token: string) => void mocks.vault.set(server, token),
  deleteRefreshToken: async (server: string) => void mocks.vault.delete(server),
}))
vi.mock('./settings', () => ({
  getSettings: () => mocks.settings,
  saveSettings: (patch: Partial<typeof mocks.settings>, options?: { immediate?: boolean }) => {
    mocks.saveSettings(patch, options)
    Object.assign(mocks.settings, patch)
  },
}))

import { ApiError, request } from './api/client'
import { NetworkError } from './platform/http'
import { useSession } from './session'

const SERVER = 'http://srv:8080'
const lena = { id: 'u1', email: 'lena@example.com', name: 'Лена М.', role: 'Frontend', tone: 0, is_admin: true }
const tokens = (n: number): TokenResponse => ({
  access_token: `access${n}`,
  refresh_token: `refresh${n}`,
  token_type: 'Bearer',
  expires_in: 43200,
  user: lena,
})
const unauthorized = () => new ApiError(401, 'invalid_refresh_token', 'Сессия недействительна')
const saved = (server: string | null, lastEmail = '') => Object.assign(mocks.settings, { serverUrl: server, lastEmail })

beforeEach(() => {
  Object.values(authApi).forEach((f) => f.mockReset())
  httpFetch.mockReset()
  saveSettings.mockReset()
  vault.clear()
  saved(null)
  useSession.setState({ phase: 'booting', serverUrl: null, accessToken: null, user: null, lastEmail: '', offlineMessage: '' })
})

const state = () => useSession.getState()

describe('запуск', () => {
  it('без адреса сервера: шаг 1', async () => {
    await state().boot()
    expect(state().phase).toBe('server')
  })

  it('адрес есть, токена нет: шаг 2, e-mail подставляется', async () => {
    saved(SERVER, 'lena@example.com')
    await state().boot()
    expect(state()).toMatchObject({ phase: 'login', serverUrl: SERVER, lastEmail: 'lena@example.com' })
    expect(authApi.refresh).not.toHaveBeenCalled()
  })

  it('есть сохранённый вход: сразу работа, токен заменяется новым', async () => {
    saved(SERVER)
    vault.set(SERVER, 'refresh0')
    authApi.refresh.mockResolvedValue(tokens(1))
    await state().boot()
    expect(authApi.refresh).toHaveBeenCalledWith(SERVER, 'refresh0')
    expect(state()).toMatchObject({ phase: 'ready', accessToken: 'access1', user: lena })
    expect(vault.get(SERVER)).toBe('refresh1')
  })

  it('сохранённый вход недействителен: токен удаляется, шаг 2', async () => {
    saved(SERVER)
    vault.set(SERVER, 'stale')
    authApi.refresh.mockRejectedValue(unauthorized())
    await state().boot()
    expect(state().phase).toBe('login')
    expect(vault.has(SERVER)).toBe(false)
  })

  it('сервер недоступен: экран «нет связи», вход не теряется', async () => {
    saved(SERVER)
    vault.set(SERVER, 'refresh0')
    authApi.refresh.mockRejectedValue(new NetworkError('Нет связи с сервером'))
    await state().boot()
    expect(state()).toMatchObject({ phase: 'offline', offlineMessage: 'Нет связи с сервером' })
    expect(vault.get(SERVER)).toBe('refresh0')

    authApi.refresh.mockResolvedValue(tokens(2))
    await state().retry()
    expect(state().phase).toBe('ready')
  })

  it('ошибка сервера (500) тоже не разлогинивает', async () => {
    saved(SERVER)
    vault.set(SERVER, 'refresh0')
    authApi.refresh.mockRejectedValue(new ApiError(500, 'internal', 'Внутренняя ошибка сервера'))
    await state().boot()
    expect(state().phase).toBe('offline')
    expect(vault.get(SERVER)).toBe('refresh0')
  })
})

describe('шаг 1: адрес сервера', () => {
  it('запоминает найденный адрес и переходит ко входу', async () => {
    authApi.findServer.mockResolvedValue(SERVER)
    await state().boot()
    await state().chooseServer('srv:8080')
    expect(authApi.findServer).toHaveBeenCalledWith('srv:8080')
    expect(saveSettings).toHaveBeenCalledWith({ serverUrl: SERVER }, { immediate: true })
    expect(state()).toMatchObject({ phase: 'login', serverUrl: SERVER })
  })

  it('для сервера с сохранённым входом сразу открывает работу', async () => {
    vault.set(SERVER, 'refresh0')
    authApi.findServer.mockResolvedValue(SERVER)
    authApi.refresh.mockResolvedValue(tokens(1))
    await state().chooseServer(SERVER)
    expect(state().phase).toBe('ready')
  })

  it('неверный адрес: ошибка уходит наверх, шаг не меняется', async () => {
    authApi.findServer.mockRejectedValue(new ApiError(0, 'unreachable', 'Не удалось подключиться'))
    await state().boot()
    await expect(state().chooseServer('nowhere')).rejects.toMatchObject({ message: 'Не удалось подключиться' })
    expect(state().phase).toBe('server')
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('«Сменить сервер» возвращает на шаг 1', async () => {
    saved(SERVER)
    await state().boot()
    state().changeServer()
    expect(state().phase).toBe('server')
    expect(state().serverUrl).toBe(SERVER)
  })
})

describe('шаг 2: вход', () => {
  beforeEach(async () => {
    saved(SERVER)
    await state().boot()
  })

  it('успешный вход: токены сохранены, e-mail запомнен', async () => {
    authApi.login.mockResolvedValue(tokens(1))
    await state().login('  lena@example.com ', 'secret')
    expect(authApi.login).toHaveBeenCalledWith(SERVER, 'lena@example.com', 'secret')
    expect(state()).toMatchObject({ phase: 'ready', accessToken: 'access1', user: lena, lastEmail: 'lena@example.com' })
    expect(vault.get(SERVER)).toBe('refresh1')
    expect(saveSettings).toHaveBeenCalledWith({ lastEmail: 'lena@example.com' }, { immediate: true })
  })

  it('неверный пароль: ошибка наверх, остаёмся на шаге 2, ничего не сохранено', async () => {
    authApi.login.mockRejectedValue(new ApiError(401, 'invalid_credentials', 'Неверный e-mail или пароль'))
    await expect(state().login('lena@example.com', 'bad')).rejects.toMatchObject({ status: 401 })
    expect(state().phase).toBe('login')
    expect(vault.size).toBe(0)
  })
})

describe('выход и потеря сессии', () => {
  beforeEach(async () => {
    saved(SERVER)
    vault.set(SERVER, 'refresh0')
    authApi.refresh.mockResolvedValue(tokens(1))
    await state().boot()
    authApi.refresh.mockReset()
  })

  it('«Выйти»: токен удаляется на сервере и у нас, экран входа', async () => {
    authApi.logout.mockResolvedValue(undefined)
    await state().logout()
    expect(authApi.logout).toHaveBeenCalledWith(SERVER, 'refresh1')
    expect(vault.has(SERVER)).toBe(false)
    expect(state()).toMatchObject({ phase: 'login', accessToken: null, user: null })
  })

  it('выход работает, даже если сервер недоступен', async () => {
    authApi.logout.mockRejectedValue(new NetworkError('Нет связи с сервером'))
    await state().logout()
    expect(vault.has(SERVER)).toBe(false)
    expect(state().phase).toBe('login')
  })

  it('401 во время работы: токен обновляется сам и запрос повторяется', async () => {
    httpFetch
      .mockResolvedValueOnce(new Response('{"code":"unauthorized","message":"Требуется вход"}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"id":"u1"}', { status: 200 }))
    authApi.refresh.mockResolvedValue(tokens(2))

    await expect(request('GET', '/me')).resolves.toEqual({ id: 'u1' })

    expect(authApi.refresh).toHaveBeenCalledWith(SERVER, 'refresh1')
    expect(state()).toMatchObject({ phase: 'ready', accessToken: 'access2' })
    expect(vault.get(SERVER)).toBe('refresh2')
    const retry = httpFetch.mock.calls[1]![1] as { headers: Record<string, string> }
    expect(retry.headers.Authorization).toBe('Bearer access2')
  })

  it('refresh-токен отозван во время работы: возврат на экран входа', async () => {
    httpFetch.mockResolvedValue(new Response('{"code":"unauthorized","message":"Требуется вход"}', { status: 401 }))
    authApi.refresh.mockRejectedValue(unauthorized())

    await expect(request('GET', '/me')).rejects.toMatchObject({ status: 401 })

    expect(state()).toMatchObject({ phase: 'login', accessToken: null, user: null })
    expect(vault.has(SERVER)).toBe(false)
  })

  it('сервер пропал во время обновления токена: сессия остаётся, ошибка сети уходит наверх', async () => {
    httpFetch.mockResolvedValue(new Response('{"code":"unauthorized","message":""}', { status: 401 }))
    authApi.refresh.mockRejectedValue(new NetworkError('Нет связи с сервером'))

    await expect(request('GET', '/me')).rejects.toBeInstanceOf(NetworkError)

    expect(state().phase).toBe('ready')
    expect(vault.get(SERVER)).toBe('refresh1')
  })
})
