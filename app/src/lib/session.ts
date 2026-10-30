// Состояние входа: на каком шаге человек (адрес сервера, e-mail и пароль, работа) и его токены.
// Токен доступа живёт только в памяти, refresh-токен лежит в хранилище учётных данных ОС (lib/platform/secrets.ts).

import { create } from 'zustand'
import * as authApi from './api/auth'
import { api, ApiError, configureClient } from './api/client'
import type { TokenResponse, UpdateProfile, User } from './api/types'
import { setLinkProbe } from './link'
import { httpFetch, NetworkError } from './platform/http'
import { deleteRefreshToken, getRefreshToken, setRefreshToken } from './platform/secrets'
import { getSettings, saveSettings } from './settings'

/**
 * booting: читаем настройки, пробуем войти по сохранённому токену
 * server: шаг 1, адрес сервера
 * login: шаг 2, e-mail и пароль
 * register: «Создать аккаунт» (e-mail, потом код из письма, имя и пароль)
 * reset: «Забыли пароль?» (e-mail, потом код из письма и новый пароль)
 * offline: сервер недоступен, вход сохранён
 * ready: работаем
 */
export type Phase = 'booting' | 'server' | 'login' | 'register' | 'reset' | 'offline' | 'ready'

/** Две цепочки «письмо с кодом»: регистрация и сброс пароля */
export type CodeKind = 'register' | 'reset'

interface SessionState {
  phase: Phase
  serverUrl: string | null
  accessToken: string | null
  user: User | null
  /** Последний использованный e-mail: подставляется в форму входа */
  lastEmail: string
  offlineMessage: string

  boot: () => Promise<void>
  /** Шаг 1: проверить адрес и перейти ко входу. Бросает ApiError с текстом для человека. */
  chooseServer: (raw: string) => Promise<void>
  /** Вернуться к шагу 1 (ссылка «Сменить сервер») */
  changeServer: () => void
  /** Шаг 2. Бросает ApiError: 401 — неверный e-mail или пароль. */
  login: (email: string, password: string) => Promise<void>
  /** Со входа на «Создать аккаунт» или «Забыли пароль?»; уже набранный e-mail переходит вместе с человеком */
  openCodeFlow: (kind: CodeKind, email?: string) => void
  /** Обратно ко входу; набранный на этих экранах e-mail возвращается вместе с человеком */
  backToLogin: (email?: string) => void
  /** Прислать код на e-mail (шаг 1 регистрации или сброса). Бросает ApiError с текстом для человека. */
  requestCode: (kind: CodeKind, email: string) => Promise<void>
  /** Регистрация, шаг 2: аккаунт создаётся, человек сразу в работе. Бросает ApiError: 400 неверный или устаревший код. */
  register: (email: string, code: string, name: string, password: string) => Promise<void>
  /** Сброс пароля, шаг 2: пароль заменён, прежние сессии завершены, человек сразу в работе. Бросает ApiError. */
  resetPassword: (email: string, code: string, newPassword: string) => Promise<void>
  logout: () => Promise<void>
  /** Сохранить изменения своего профиля (PATCH /me); в сессии остаётся то, что вернул сервер. Бросает ApiError. */
  updateProfile: (patch: UpdateProfile) => Promise<void>
  /**
   * Сменить пароль. Сервер завершает все прежние сессии, и эту тоже, а этому устройству сразу выдаёт новую пару:
   * заново входить не нужно. Бросает ApiError; неверный текущий пароль это 400 `wrong_password`, сессия остаётся.
   */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  /** Повторить вход после «нет связи» */
  retry: () => Promise<void>
  /** Новый токен доступа (один обмен на всех: refresh-токен одноразовый). null — войти заново. */
  refreshAccessToken: () => Promise<string | null>
}

export const useSession = create<SessionState>()((set, get) => {
  async function applyTokens(tokens: TokenResponse): Promise<void> {
    const server = get().serverUrl
    if (server) await setRefreshToken(server, tokens.refresh_token)
    set({ accessToken: tokens.access_token, user: tokens.user, phase: 'ready' })
  }

  /** Вход по сохранённому refresh-токену, без участия человека */
  async function silentLogin(): Promise<void> {
    const server = get().serverUrl
    if (!server) return set({ phase: 'server' })
    const token = await getRefreshToken(server)
    if (!token) return set({ phase: 'login' })
    try {
      await applyTokens(await authApi.refresh(server, token))
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await deleteRefreshToken(server)
        set({ phase: 'login' })
      } else {
        // сервер недоступен или сломан: вход не теряем, даём повторить
        set({ phase: 'offline', offlineMessage: e instanceof NetworkError ? e.message : 'Сервер ответил ошибкой' })
      }
    }
  }

  let inflight: Promise<string | null> | null = null

  /** Новый токен доступа для клиента API. Один обмен на всех: refresh-токен одноразовый. */
  function refreshAccessToken(): Promise<string | null> {
    inflight ??= (async () => {
      const server = get().serverUrl
      const token = server ? await getRefreshToken(server) : null
      if (!server || !token) return null
      try {
        const tokens = await authApi.refresh(server, token)
        await setRefreshToken(server, tokens.refresh_token)
        set({ accessToken: tokens.access_token, user: tokens.user })
        return tokens.access_token
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await deleteRefreshToken(server)
          return null
        }
        throw e
      }
    })().finally(() => {
      inflight = null
    })
    return inflight
  }

  configureClient({
    getServer: () => get().serverUrl,
    getAccessToken: () => get().accessToken,
    refreshAccessToken,
    onSessionLost: () => set({ phase: 'login', accessToken: null, user: null }),
  })

  // пока связи нет, она проверяется сама (lib/link.ts): отвечает ли сервер на /healthz
  setLinkProbe(async () => {
    const server = get().serverUrl
    if (!server) return false
    try {
      return (await httpFetch(`${server}/healthz`, { timeoutMs: 5_000 })).ok
    } catch {
      return false
    }
  })

  return {
    phase: 'booting',
    serverUrl: null,
    accessToken: null,
    user: null,
    lastEmail: '',
    offlineMessage: '',

    async boot() {
      const { serverUrl, lastEmail } = getSettings()
      set({ serverUrl, lastEmail })
      await silentLogin()
    },

    async chooseServer(raw) {
      const url = await authApi.findServer(raw)
      saveSettings({ serverUrl: url }, { immediate: true })
      set({ serverUrl: url })
      // для этого сервера вход мог быть сохранён раньше
      await silentLogin()
    },

    changeServer: () => set({ phase: 'server' }),

    async login(email, password) {
      const server = get().serverUrl
      if (!server) throw new ApiError(0, 'no_server', 'Не задан адрес сервера')
      const tokens = await authApi.login(server, email.trim(), password)
      saveSettings({ lastEmail: tokens.user.email }, { immediate: true })
      set({ lastEmail: tokens.user.email })
      await applyTokens(tokens)
    },

    openCodeFlow: (kind, email) => set(email?.trim() ? { phase: kind, lastEmail: email.trim() } : { phase: kind }),

    backToLogin: (email) => set(email?.trim() ? { phase: 'login', lastEmail: email.trim() } : { phase: 'login' }),

    async requestCode(kind, email) {
      const server = get().serverUrl
      if (!server) throw new ApiError(0, 'no_server', 'Не задан адрес сервера')
      const request = kind === 'register' ? authApi.requestRegisterCode : authApi.requestResetCode
      await request(server, email.trim())
    },

    async register(email, code, name, password) {
      const server = get().serverUrl
      if (!server) throw new ApiError(0, 'no_server', 'Не задан адрес сервера')
      const tokens = await authApi.register(server, email.trim(), code, name.trim(), password)
      saveSettings({ lastEmail: tokens.user.email }, { immediate: true })
      set({ lastEmail: tokens.user.email })
      await applyTokens(tokens)
    },

    async resetPassword(email, code, newPassword) {
      const server = get().serverUrl
      if (!server) throw new ApiError(0, 'no_server', 'Не задан адрес сервера')
      const tokens = await authApi.resetPassword(server, email.trim(), code, newPassword)
      saveSettings({ lastEmail: tokens.user.email }, { immediate: true })
      set({ lastEmail: tokens.user.email })
      await applyTokens(tokens)
    },

    async logout() {
      const server = get().serverUrl
      if (server) {
        const token = await getRefreshToken(server)
        if (token) await authApi.logout(server, token).catch(() => undefined) // не вышло на сервере, всё равно выходим локально
        await deleteRefreshToken(server)
      }
      set({ phase: 'login', accessToken: null, user: null })
    },

    async updateProfile(patch) {
      set({ user: await api.patch<User>('/me', patch) })
    },

    async changePassword(currentPassword, newPassword) {
      const tokens = await api.post<TokenResponse>('/auth/password', { current_password: currentPassword, new_password: newPassword })
      await applyTokens(tokens)
    },

    async retry() {
      set({ phase: 'booting' })
      await silentLogin()
    },

    refreshAccessToken,
  }
})
