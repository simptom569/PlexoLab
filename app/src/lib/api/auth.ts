// Запросы без токена: проверка сервера, вход, обновление и выход.

import { httpFetch, NetworkError } from '../platform/http'
import { ApiError, readError } from './client'
import { originOf, serverCandidates } from './serverUrl'
import type { TokenResponse } from './types'

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
