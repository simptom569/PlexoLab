// Соединение с сервером для живых обновлений. Подключается, входит первым сообщением с токеном, после `ready` слушает
// события. Если связь оборвалась, подключается заново с нарастающей паузой (1, 2, 4, 8, 15, 30 секунд, с небольшим
// разбросом, чтобы клиенты не стучались все разом после падения сервера). Не слышит сервер дольше `IDLE_MS` (он шлёт
// `ping` каждые 25 секунд): считает связь мёртвой, как бывает после сна ноутбука или смены сети, и подключается заново.
// Протокол описан в server/crates/api/src/ws.rs.

import { parseMessage, type Message } from './events'

/** connecting — подключаемся или входим, open — связь есть, offline — связи нет, ждём повторной попытки */
export type ConnectionStatus = 'connecting' | 'open' | 'offline'

/** То, что нужно от WebSocket: так соединение проверяется без настоящей сети */
export interface SocketLike {
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  onerror: ((event: Event) => void) | null
  send(data: string): void
  close(code?: number): void
}

export type ConnectionOptions = {
  /** Адрес сокета; null, если сервер не выбран */
  url: () => string | null
  /** Токен доступа для входа */
  token: () => string | null
  /** Новый токен доступа, когда сервер закрыл соединение кодом 4401 (токен истёк); null — войти заново */
  refreshToken: () => Promise<string | null>
  onStatus: (status: ConnectionStatus) => void
  /** Событие или `resync`; `ready` и `ping` соединение разбирает само */
  onMessage: (message: Message) => void
  /**
   * Сервер ответил `ready`. `catchUp`: до этого связь теряли, значит, часть изменений прошла мимо нас и данные
   * надо перечитать. При первом подключении без неудач перечитывать нечего: данные только что загружены.
   */
  onReady: (catchUp: boolean) => void
  createSocket?: (url: string) => SocketLike
  /** Случайное число от 0 до 1 для разброса пауз (тестам нужно своё) */
  random?: () => number
}

/** `http://host:8080` → `ws://host:8080/api/v1/ws`, `https://…` → `wss://…`; null, если сервер не выбран */
export function socketUrl(server: string | null): string | null {
  return server ? `${server.replace(/\/+$/, '').replace(/^http/i, 'ws')}/api/v1/ws` : null
}

/** Паузы перед повторами: после последней остаётся последняя */
export const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000]
/** Разброс паузы: от 80% до 120% */
const JITTER = 0.2
/** Сколько ждать `ready` после подключения */
export const CONNECT_TIMEOUT_MS = 10_000
/** Сколько можно ничего не слышать от сервера, пока связь «открыта» */
export const IDLE_MS = 60_000

/** Коды закрытия сервера (ws.rs) */
const CLOSE_UNAUTHORIZED = 4401

const defaultSocket = (url: string): SocketLike => new WebSocket(url)

export class RealtimeConnection {
  private readonly options: ConnectionOptions
  private socket: SocketLike | null = null
  /** Номер подключения: события давно закрытого сокета ничего не меняют */
  private generation = 0
  private stopped = true
  private status: ConnectionStatus = 'offline'
  private attempt = 0
  private catchUp = false
  private unauthorizedStreak = 0
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private watchdog: ReturnType<typeof setTimeout> | undefined

  constructor(options: ConnectionOptions) {
    this.options = options
  }

  get current(): ConnectionStatus {
    return this.status
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.retryNow)
      document.addEventListener('visibilitychange', this.onVisible)
    }
    this.connect()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.retryTimer)
    clearTimeout(this.watchdog)
    this.generation++
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.retryNow)
      document.removeEventListener('visibilitychange', this.onVisible)
    }
    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.onclose = null
      socket.close(1000)
    }
    this.attempt = 0
    this.catchUp = false
    this.unauthorizedStreak = 0
    this.setStatus('offline')
  }

  // ----- внутреннее -----

  private setStatus(status: ConnectionStatus) {
    if (status === this.status) return
    this.status = status
    this.options.onStatus(status)
  }

  /** Сеть вернулась или окно снова на виду: если связи нет, не ждём очередной паузы */
  private readonly retryNow = () => {
    if (this.stopped || this.status !== 'offline') return
    clearTimeout(this.retryTimer)
    this.attempt = 0
    this.connect()
  }

  private readonly onVisible = () => {
    if (document.visibilityState === 'visible') this.retryNow()
  }

  private arm(ms: number) {
    clearTimeout(this.watchdog)
    this.watchdog = setTimeout(() => this.socket?.close(), ms)
  }

  private connect() {
    if (this.stopped) return
    clearTimeout(this.retryTimer)
    const url = this.options.url()
    const token = this.options.token()
    if (!url || !token) {
      this.lost()
      return
    }

    this.setStatus('connecting')
    const generation = ++this.generation
    const current = () => generation === this.generation
    let socket: SocketLike
    try {
      socket = (this.options.createSocket ?? defaultSocket)(url)
    } catch {
      this.lost()
      return
    }
    this.socket = socket
    this.arm(CONNECT_TIMEOUT_MS)

    socket.onopen = () => {
      if (current()) socket.send(JSON.stringify({ type: 'auth', token }))
    }
    socket.onmessage = (event) => {
      if (!current() || typeof event.data !== 'string') return
      const message = parseMessage(event.data)
      if (!message) return
      if (message.kind === 'ping') {
        this.arm(IDLE_MS)
        socket.send(JSON.stringify({ type: 'pong' }))
      } else if (message.kind === 'ready') {
        this.arm(IDLE_MS)
        this.attempt = 0
        this.unauthorizedStreak = 0
        const catchUp = this.catchUp
        this.catchUp = false
        this.setStatus('open')
        this.options.onReady(catchUp)
      } else if (message.kind !== 'error') {
        this.arm(IDLE_MS)
        this.options.onMessage(message)
      }
    }
    socket.onclose = (event) => {
      if (!current()) return
      this.socket = null
      clearTimeout(this.watchdog)
      if (event.code === CLOSE_UNAUTHORIZED) void this.renewAndReconnect()
      else this.lost()
    }
    // за ошибкой всегда следует закрытие, разбираемся там
    socket.onerror = () => undefined
  }

  /** Связи нет: повторим позже. Всё, что случится до новой связи, придётся перечитать. */
  private lost() {
    if (this.stopped) return
    this.catchUp = true
    this.setStatus('offline')
    const base = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]!
    const random = this.options.random ?? Math.random
    const delay = Math.round(base * (1 - JITTER + 2 * JITTER * random()))
    this.attempt++
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => this.connect(), delay)
  }

  /** Токен истёк: берём новый и подключаемся сразу. Если и новый не принят, дальше обычными паузами. */
  private async renewAndReconnect() {
    this.catchUp = true
    this.unauthorizedStreak++
    this.setStatus('connecting')
    if (this.unauthorizedStreak > 2) return this.lost()
    try {
      const token = await this.options.refreshToken()
      if (this.stopped) return
      if (!token) {
        // вход потерян: что делать дальше, решит экран входа, а мы больше не стучимся
        this.setStatus('offline')
        return
      }
    } catch {
      return this.lost()
    }
    this.connect()
  }
}
