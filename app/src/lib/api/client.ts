// HTTP-клиент API. Токен доступа подставляется сам. Если сервер ответил 401, клиент один раз обновляет токен
// и повторяет запрос. Если обновить не вышло, сессия считается потерянной и человек возвращается на экран входа.

import { linkLost, linkRestored, OfflineError, useLink } from '../link'
import { httpFetch, NetworkError } from '../platform/http'
import { CLIENT_ID } from '../realtime/clientId'

export class ApiError extends Error {
  readonly status: number
  /** Машинный код сервера: bad_request, not_found, conflict, ... */
  readonly code: string
  /** Тело ответа целиком: у 409 на вики там лежит `current`, актуальная версия страницы */
  readonly body: unknown

  constructor(status: number, code: string, message: string, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.body = body
  }
}

/** Ответы, которыми прокси сообщает, что сервер за ним не отвечает: это «связи нет», а не отказ сервера */
const GATEWAY_STATUSES = new Set([502, 503, 504])

/**
 * Не дошло до сервера: запрос оборвался, прокси не достучался до сервера или запись отклонена в режиме «только
 * просмотр». Повторять такое бессмысленно, пока не вернётся связь; плашку об ошибке показывать не нужно, о связи
 * говорит полоска сверху.
 */
export function isConnectionError(e: unknown): boolean {
  return e instanceof NetworkError || e instanceof OfflineError || (e instanceof ApiError && GATEWAY_STATUSES.has(e.status))
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
    return new ApiError(res.status, body.code ?? 'error', body.message ?? `Ошибка ${res.status}`, body)
  } catch {
    return new ApiError(res.status, 'error', `Сервер ответил ошибкой ${res.status}`)
  }
}

/** Большие файлы грузятся и скачиваются долго: вместо обычных 15 секунд даём десять минут */
const TRANSFER_TIMEOUT_MS = 10 * 60_000

type Payload = { json?: unknown; form?: FormData }
type CallOptions = { accept?: string; timeoutMs?: number }

/** Запрос к /api/v1 с токеном; при 401 один раз обновляет токен и повторяет. Ошибочные ответы становятся ApiError. */
async function call(method: Method, path: string, payload: Payload, { accept = 'application/json', timeoutMs }: CallOptions = {}): Promise<Response> {
  if (!hooks) throw new Error('Клиент API не настроен')
  const h = hooks
  const server = h.getServer()
  if (!server) throw new ApiError(0, 'no_server', 'Не задан адрес сервера')
  // «только просмотр»: запись без связи не отправляется, экран откатится сразу (читать можно всегда)
  if (method !== 'GET' && useLink.getState().readOnly) throw new OfflineError()

  const send = (token: string | null) =>
    httpFetch(`${server}/api/v1${path}`, {
      method,
      headers: {
        Accept: accept,
        // сервер вернёт эту метку в событиях об изменении, и мы пропустим их: свои изменения экран уже показал
        'X-Client-Id': CLIENT_ID,
        // у формы тип содержимого с границей частей выставляет сам fetch
        ...(payload.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: payload.form ?? (payload.json !== undefined ? JSON.stringify(payload.json) : undefined),
      ...(timeoutMs ? { timeoutMs } : {}),
    })

  try {
    let res = await send(h.getAccessToken())
    if (res.status === 401) {
      const token = await h.refreshAccessToken()
      if (!token) {
        h.onSessionLost()
        throw await readError(res)
      }
      res = await send(token)
    }
    // ответил сам сервер (даже отказом) — связь есть; прокси без сервера за ним — связи нет
    if (GATEWAY_STATUSES.has(res.status)) linkLost()
    else linkRestored()
    if (!res.ok) throw await readError(res)
    return res
  } catch (e) {
    // запрос не дошёл (и обновление токена тоже): связи нет
    if (e instanceof NetworkError) linkLost()
    throw e
  }
}

/** Запрос с JSON-телом; для 204 возвращается undefined. */
export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const res = await call(method, path, { json: body })
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: (path: string) => request<void>('DELETE', path),
  /** Загрузка файлов формой multipart/form-data */
  upload: async <T>(path: string, form: FormData) =>
    (await (await call('POST', path, { form }, { timeoutMs: TRANSFER_TIMEOUT_MS })).json()) as T,
  /** Скачивание содержимого файла */
  download: async (path: string) => (await call('GET', path, {}, { accept: '*/*', timeoutMs: TRANSFER_TIMEOUT_MS })).blob(),
}
