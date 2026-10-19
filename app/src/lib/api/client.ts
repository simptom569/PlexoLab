// HTTP-клиент API. Токен доступа подставляется сам. Если сервер ответил 401, клиент один раз обновляет токен
// и повторяет запрос. Если обновить не вышло, сессия считается потерянной и человек возвращается на экран входа.

import { httpFetch } from '../platform/http'

export class ApiError extends Error {
  readonly status: number
  /** Машинный код сервера: bad_request, not_found, conflict, ... */
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** Связь клиента с состоянием входа (реализует lib/session.ts) */
export interface ClientHooks {
  getServer(): string | null
  getAccessToken(): string | null
  /** Получить новый токен доступа. null — войти заново (refresh-токен недействителен). */
  refreshAccessToken(): Promise<string | null>
  onSessionLost(): void
}

let hooks: ClientHooks | null = null

export function configureClient(h: ClientHooks): void {
  hooks = h
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export async function readError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { code?: string; message?: string }
    return new ApiError(res.status, body.code ?? 'error', body.message ?? `Ошибка ${res.status}`)
  } catch {
    return new ApiError(res.status, 'error', `Сервер ответил ошибкой ${res.status}`)
  }
}

/** Запрос к /api/v1 с токеном. Тело отправляется как JSON; для 204 возвращается undefined. */
export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  if (!hooks) throw new Error('Клиент API не настроен')
  const h = hooks
  const server = h.getServer()
  if (!server) throw new ApiError(0, 'no_server', 'Не задан адрес сервера')

  const send = (token: string | null) =>
    httpFetch(`${server}/api/v1${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

  let res = await send(h.getAccessToken())
  if (res.status === 401) {
    const token = await h.refreshAccessToken()
    if (!token) {
      h.onSessionLost()
      throw await readError(res)
    }
    res = await send(token)
  }
  if (!res.ok) throw await readError(res)
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: (path: string) => request<void>('DELETE', path),
}
