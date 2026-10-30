// Запросы без токена: проверка сервера, вход, регистрация, сброс пароля, обновление и выход.

import { httpFetch, NetworkError } from '../platform/http'
import { ApiError, readError } from './client'
import { originOf, serverCandidates } from './serverUrl'
import type { AuthOptions, TokenResponse } from './types'

async function postJson<T>(server: string, path: string, body: unknown): Promise<T> {
  const res = await httpFetch(`${server}/api/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await readError(res)
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

export const login = (server: string, email: string, password: string) =>
  postJson<TokenResponse>(server, '/auth/login', { email, password })

/**
 * Что умеет сервер до входа: настроена ли почта, а с ней регистрация и «Забыли пароль?». Сервер без этой ручки
 * (старый) и любая ошибка означают «нет»: ссылок на экране входа просто не будет.
 */
export async function fetchOptions(server: string): Promise<AuthOptions> {
  const none = { registration: false, password_reset: false }
  try {
    const res = await httpFetch(`${server}/api/v1/auth/options`, { headers: { Accept: 'application/json' }, timeoutMs: 6000 })
    if (!res.ok) return none
    const body = (await res.json()) as Partial<AuthOptions>
    return { registration: body.registration === true, password_reset: body.password_reset === true }
  } catch {
    return none
  }
}

/** Регистрация, шаг 1: прислать код на e-mail */
export const requestRegisterCode = (server: string, email: string) => postJson<void>(server, '/auth/register/code', { email })

/** Регистрация, шаг 2: код из письма, имя и пароль. Аккаунт создаётся, человек сразу вошёл. */
export const register = (server: string, email: string, code: string, name: string, password: string) =>
  postJson<TokenResponse>(server, '/auth/register', { email, code, name, password })

/** Сброс пароля, шаг 1: прислать код на e-mail (ответ один и тот же, есть такой аккаунт или нет) */
export const requestResetCode = (server: string, email: string) => postJson<void>(server, '/auth/password-reset/code', { email })

/** Сброс пароля, шаг 2: код из письма и новый пароль. Прежние сессии завершены, человек сразу вошёл. */
export const resetPassword = (server: string, email: string, code: string, newPassword: string) =>
  postJson<TokenResponse>(server, '/auth/password-reset', { email, code, new_password: newPassword })

export const refresh = (server: string, refreshToken: string) =>
  postJson<TokenResponse>(server, '/auth/refresh', { refresh_token: refreshToken })

export const logout = (server: string, refreshToken: string) => postJson<void>(server, '/auth/logout', { refresh_token: refreshToken })

/** Отвечает ли по адресу сервер PlexoLab. Возвращает адрес, на котором он найден (после переадресаций). */
async function probe(origin: string): Promise<string> {
  const res = await httpFetch(`${origin}/healthz`, { timeoutMs: 6000 })
  const text = res.ok ? (await res.text()).trim() : ''
  if (text !== 'ok') throw new ApiError(res.status, 'not_plexolab', 'По этому адресу отвечает не сервер PlexoLab')
  // если сервер переадресовал с http на https, запоминаем адрес, на котором он действительно отвечает
  return originOf(res.url) ?? origin
}

/** Проверка связи из настроек: за сколько миллисекунд ответил сервер. Бросает ошибку с понятным текстом. */
export async function pingServer(origin: string): Promise<number> {
  const started = performance.now()
  await probe(origin)
  return Math.round(performance.now() - started)
}

/**
 * Проверяет введённый адрес и возвращает рабочий. Без схемы пробует https и http одновременно
 * и предпочитает https. Бросает ошибку с понятным текстом.
 */
export async function findServer(raw: string): Promise<string> {
  const candidates = serverCandidates(raw)
  if (!candidates.ok) throw new ApiError(0, 'bad_address', candidates.reason)

  const results = await Promise.allSettled(candidates.urls.map(probe))
  for (const r of results) if (r.status === 'fulfilled') return r.value

  const failure = results.map((r) => (r as PromiseRejectedResult).reason)
  const notPlexo = failure.find((e) => e instanceof ApiError)
  if (notPlexo) throw notPlexo
  const net = failure.find((e): e is NetworkError => e instanceof NetworkError)
  throw new ApiError(0, 'unreachable', net?.message === 'Сервер не ответил вовремя' ? 'Сервер не ответил вовремя. Проверьте адрес и сеть.' : 'Не удалось подключиться по этому адресу. Проверьте адрес и сеть.')
}
