// Запросы к серверу. В окне Tauri они идут из Rust (tauri-plugin-http): нет CORS, нет запрета смешанного
// содержимого, одинаково работают http и https и переадресации. В браузере (разработка, тесты) это обычный fetch.

import { isTauri } from './runtime'

export type HttpInit = RequestInit & {
  /** Прервать, если сервер не ответил за столько миллисекунд */
  timeoutMs?: number
}

export class NetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'NetworkError'
  }
}

export async function httpFetch(url: string, init: HttpInit = {}): Promise<Response> {
  const { timeoutMs = 15_000, signal, ...rest } = init
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  try {
    const doFetch = isTauri() ? (await import('@tauri-apps/plugin-http')).fetch : window.fetch.bind(window)
    return await doFetch(url, { ...rest, signal: controller.signal })
  } catch (e) {
    const timedOut = controller.signal.aborted && !signal?.aborted
    throw new NetworkError(timedOut ? 'Сервер не ответил вовремя' : 'Нет связи с сервером', { cause: e })
  } finally {
    clearTimeout(timer)
  }
}
