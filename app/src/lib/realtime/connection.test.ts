import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKOFF_MS, CONNECT_TIMEOUT_MS, IDLE_MS, RealtimeConnection, socketUrl, type ConnectionOptions, type ConnectionStatus, type SocketLike } from './connection'
import type { Message } from './events'

class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null
  onmessage: SocketLike['onmessage'] = null
  onclose: SocketLike['onclose'] = null
  onerror: SocketLike['onerror'] = null
  sent: unknown[] = []
  closedWith: number | null | undefined = null
  readonly url: string
  constructor(url: string) {
    this.url = url
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close(code?: number) {
    this.closedWith = code ?? 1005
    // как у настоящего сокета: после close() приходит событие закрытия
    queueMicrotask(() => this.onclose?.({ code: code ?? 1005 } as CloseEvent))
  }
  // ---- со стороны «сервера» ----
  open() {
    this.onopen?.({} as Event)
  }
  say(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent)
  }
  serverCloses(code: number) {
    this.onclose?.({ code } as CloseEvent)
  }
}

describe('socketUrl', () => {
  it('http → ws, https → wss, лишние слэши убираются', () => {
    expect(socketUrl('http://192.168.1.5:8080')).toBe('ws://192.168.1.5:8080/api/v1/ws')
    expect(socketUrl('https://team.example.com')).toBe('wss://team.example.com/api/v1/ws')
    expect(socketUrl('https://team.example.com/')).toBe('wss://team.example.com/api/v1/ws')
    expect(socketUrl('HTTP://Host')).toBe('ws://Host/api/v1/ws')
  })

  it('сервер не выбран — адреса нет', () => {
    expect(socketUrl(null)).toBeNull()
    expect(socketUrl('')).toBeNull()
  })
})

describe('RealtimeConnection', () => {
  let sockets: FakeSocket[]
  let statuses: ConnectionStatus[]
  let messages: Message[]
  let ready: boolean[]
  let token: string | null
  let refresh: ReturnType<typeof vi.fn<() => Promise<string | null>>>
  let conn: RealtimeConnection

  const last = () => sockets[sockets.length - 1]!
  /** Подключились и вошли */
  const login = (socket = last()) => {
    socket.open()
    socket.say({ type: 'ready' })
  }

  function make(extra: Partial<ConnectionOptions> = {}) {
    return new RealtimeConnection({
      url: () => 'ws://server/api/v1/ws',
      token: () => token,
      refreshToken: refresh,
      onStatus: (s) => statuses.push(s),
      onMessage: (m) => messages.push(m),
      onReady: (catchUp) => ready.push(catchUp),
      createSocket: (url) => {
        const s = new FakeSocket(url)
        sockets.push(s)
        return s
      },
      random: () => 0.5, // без разброса: пауза ровно как в таблице
      ...extra,
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    sockets = []
    statuses = []
    messages = []
    ready = []
    token = 'tok1'
    refresh = vi.fn(() => Promise.resolve<string | null>('tok2'))
    conn = make()
  })
  afterEach(() => {
    conn.stop()
    vi.useRealTimers()
  })

  it('подключается и первым сообщением присылает токен; пока не ответили «ready», связь не «открыта»', () => {
    conn.start()
    expect(statuses).toEqual(['connecting'])
    expect(last().url).toBe('ws://server/api/v1/ws')
    last().open()
    expect(last().sent).toEqual([{ type: 'auth', token: 'tok1' }])
    expect(conn.current).toBe('connecting')
    last().say({ type: 'ready' })
    expect(conn.current).toBe('open')
    expect(statuses).toEqual(['connecting', 'open'])
  })

  it('первое подключение без неудач перечитывать данные не просит: они только что загружены', () => {
    conn.start()
    login()
    expect(ready).toEqual([false])
  })

  it('события и resync уходят наружу, ping получает pong, ошибки и мусор игнорируются', () => {
    conn.start()
    login()
    last().say({ type: 'task.updated', id: 't1', project_id: null, origin: 'c1' })
    last().say({ type: 'resync' })
    last().say({ type: 'ping' })
    last().say({ type: 'error', code: 'unauthorized' })
    last().onmessage?.({ data: 'не json' } as MessageEvent)
    last().onmessage?.({ data: new ArrayBuffer(2) } as MessageEvent)
    expect(messages).toEqual([
      { kind: 'event', event: { type: 'task.updated', id: 't1', project_id: null, origin: 'c1' } },
      { kind: 'resync' },
    ])
    expect(last().sent).toEqual([{ type: 'auth', token: 'tok1' }, { type: 'pong' }])
  })

  it('обрыв: «нет связи», повтор через секунду, после входа просит перечитать данные', () => {
    conn.start()
    login()
    last().serverCloses(1006)
    expect(conn.current).toBe('offline')
    expect(sockets).toHaveLength(1)
    vi.advanceTimersByTime(BACKOFF_MS[0]! - 1)
    expect(sockets).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(sockets).toHaveLength(2)
    expect(conn.current).toBe('connecting')
    login()
    expect(conn.current).toBe('open')
    expect(ready).toEqual([false, true]) // пока связи не было, мимо прошли чужие изменения
  })

  it('паузы растут: 1, 2, 4, 8, 15, 30 секунд и дальше по 30', () => {
    conn.start()
    const waits: number[] = []
    for (let i = 0; i < 8; i++) {
      last().serverCloses(1006)
      const before = sockets.length
      let waited = 0
      while (sockets.length === before && waited < 40_000) {
        vi.advanceTimersByTime(250)
        waited += 250
      }
      waits.push(waited)
    }
    expect(waits).toEqual([...BACKOFF_MS, 30_000, 30_000])
  })

  it('удачное подключение сбрасывает паузу', () => {
    conn.start()
    for (let i = 0; i < 3; i++) {
      last().serverCloses(1006)
      vi.advanceTimersByTime(60_000)
    }
    login()
    last().serverCloses(1006)
    vi.advanceTimersByTime(BACKOFF_MS[0]!)
    expect(sockets).toHaveLength(5) // после входа снова секунда, а не восемь
  })

  it('к паузе добавляется разброс от 80% до 120%', () => {
    for (const [random, expected] of [[0, 800], [1, 1200]] as const) {
      conn.stop()
      sockets = []
      conn = make({ random: () => random })
      conn.start()
      last().serverCloses(1006)
      vi.advanceTimersByTime(expected - 1)
      expect(sockets).toHaveLength(1)
      vi.advanceTimersByTime(1)
      expect(sockets).toHaveLength(2)
    }
  })

  it('токен истёк (4401): берётся новый и подключение идёт сразу, без паузы', async () => {
    conn.start()
    login()
    token = 'tok2' // так делает сессия после обновления
    last().serverCloses(4401)
    expect(conn.current).toBe('connecting')
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(sockets).toHaveLength(2)
    last().open()
    expect(last().sent).toEqual([{ type: 'auth', token: 'tok2' }])
    last().say({ type: 'ready' })
    expect(ready).toEqual([false, true])
  })

  it('если войти заново не получается, соединение больше не стучится', async () => {
    refresh.mockResolvedValue(null)
    conn.start()
    login()
    last().serverCloses(4401)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(sockets).toHaveLength(1)
    expect(conn.current).toBe('offline')
  })

  it('сервер упорно закрывает с 4401 даже с новым токеном: дальше обычными паузами', async () => {
    conn.start()
    for (let i = 0; i < 2; i++) {
      last().serverCloses(4401)
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(sockets).toHaveLength(3)
    last().serverCloses(4401) // третий раз подряд
    await vi.advanceTimersByTimeAsync(0)
    expect(sockets).toHaveLength(3)
    expect(conn.current).toBe('offline')
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]!)
    expect(sockets).toHaveLength(4)
  })

  it('не вышло обновить токен из-за сети: повтор обычными паузами', async () => {
    refresh.mockRejectedValueOnce(new Error('сеть'))
    conn.start()
    last().serverCloses(4401)
    await vi.advanceTimersByTimeAsync(0)
    expect(conn.current).toBe('offline')
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]!)
    expect(sockets).toHaveLength(2)
  })

  it('сервер молчит дольше положенного: связь считается мёртвой и открывается заново', async () => {
    conn.start()
    login()
    vi.advanceTimersByTime(IDLE_MS - 1)
    expect(last().closedWith).toBeNull()
    vi.advanceTimersByTime(1)
    expect(last().closedWith).not.toBeNull()
    await vi.advanceTimersByTimeAsync(0)
    expect(conn.current).toBe('offline')
    vi.advanceTimersByTime(BACKOFF_MS[0]!)
    expect(sockets).toHaveLength(2)
  })

  it('каждое сообщение сервера (ping, событие) продлевает ожидание', () => {
    conn.start()
    login()
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(IDLE_MS - 1000)
      last().say({ type: 'ping' })
    }
    expect(last().closedWith).toBeNull()
    expect(sockets).toHaveLength(1)
  })

  it('если «ready» не пришёл за отведённое время, попытка прерывается', async () => {
    conn.start()
    last().open()
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS)
    expect(last().closedWith).not.toBeNull()
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]!)
    expect(sockets).toHaveLength(2)
  })

  it('нет адреса или токена: не подключается, а ждёт и пробует снова', () => {
    token = null
    conn.start()
    expect(sockets).toHaveLength(0)
    expect(conn.current).toBe('offline')
    token = 'tok1'
    vi.advanceTimersByTime(BACKOFF_MS[0]!)
    expect(sockets).toHaveLength(1)
  })

  it('stop закрывает сокет, отменяет повторы и больше ничего не сообщает', async () => {
    conn.start()
    login()
    const socket = last()
    conn.stop()
    expect(socket.closedWith).toBe(1000)
    expect(conn.current).toBe('offline')
    const seen = statuses.length
    await vi.advanceTimersByTimeAsync(120_000)
    expect(sockets).toHaveLength(1)
    expect(statuses).toHaveLength(seen)
    socket.say({ type: 'task.updated' }) // запоздавшее сообщение старого сокета
    expect(messages).toEqual([])
  })

  it('запоздалые события давно закрытого сокета не влияют на новый', () => {
    conn.start()
    const old = last()
    old.open()
    old.serverCloses(1006)
    vi.advanceTimersByTime(BACKOFF_MS[0]!)
    const fresh = last()
    expect(fresh).not.toBe(old)
    old.say({ type: 'ready' })
    old.serverCloses(1006)
    expect(conn.current).toBe('connecting')
    expect(ready).toEqual([])
  })

  it('двойной start ничего не делает', () => {
    conn.start()
    conn.start()
    expect(sockets).toHaveLength(1)
  })

  it('сокет не создаётся (исключение): повтор по паузе', () => {
    conn.stop()
    conn = make({
      createSocket: () => {
        throw new Error('нельзя')
      },
    })
    conn.start()
    expect(conn.current).toBe('offline')
    vi.advanceTimersByTime(BACKOFF_MS[0]!)
    expect(conn.current).toBe('offline')
  })
})
