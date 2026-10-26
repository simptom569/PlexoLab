import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Сеть подменяем: проверяем, что клиент делает с ответами сервера
const httpFetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
vi.mock('../platform/http', () => ({
  httpFetch: (url: string, init?: RequestInit) => httpFetch(url, init),
  NetworkError: class NetworkError extends Error {},
}))

import { linkLost, OfflineError, resetLink, useLink } from '../link'
import { NetworkError } from '../platform/http'
import { api, ApiError, configureClient, isConnectionError, request } from './client'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let access: string | null
let refreshed: Promise<string | null> | null
const lost = vi.fn()
const refresh = vi.fn<() => Promise<string | null>>()

beforeEach(() => {
  resetLink()
  httpFetch.mockReset()
  refresh.mockReset()
  lost.mockReset()
  access = 'tok1'
  refreshed = null
  configureClient({
    getServer: () => 'http://srv:8080',
    getAccessToken: () => access,
    refreshAccessToken: () => (refreshed ??= refresh()),
    onSessionLost: lost,
  })
})

const call = (n: number) => httpFetch.mock.calls[n] as [string, RequestInit & { headers: Record<string, string> }]

describe('request', () => {
  it('подставляет адрес, токен и JSON', async () => {
    httpFetch.mockResolvedValue(json(200, { ok: 1 }))
    const r = await api.post<{ ok: number }>('/tags', { label: 'Баг' })
    expect(r).toEqual({ ok: 1 })
    const [url, init] = call(0)
    expect(url).toBe('http://srv:8080/api/v1/tags')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok1')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe('{"label":"Баг"}')
  })

  it('GET без тела не шлёт Content-Type; 204 даёт undefined', async () => {
    httpFetch.mockResolvedValueOnce(json(200, [])).mockResolvedValueOnce(new Response(null, { status: 204 }))
    await api.get('/tags')
    expect(call(0)[1].headers['Content-Type']).toBeUndefined()
    expect(call(0)[1].body).toBeUndefined()
    expect(await api.delete('/tags/1')).toBeUndefined()
  })

  it('поле null в PATCH доходит до сервера, а undefined пропадает', async () => {
    httpFetch.mockResolvedValue(json(200, {}))
    await api.patch('/tasks/1', { assignee_id: null, title: undefined, before_id: null })
    expect(call(0)[1].body).toBe('{"assignee_id":null,"before_id":null}')
  })

  it('ошибку сервера превращает в ApiError с кодом и текстом', async () => {
    httpFetch.mockResolvedValue(json(400, { code: 'bad_request', message: 'Название: от 1 до 500 символов' }))
    const err = await api.post('/tasks', {}).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 400, code: 'bad_request', message: 'Название: от 1 до 500 символов' })
  })

  it('не-JSON ответ об ошибке тоже даёт ApiError', async () => {
    httpFetch.mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }))
    await expect(api.get('/x')).rejects.toMatchObject({ status: 502, code: 'error' })
  })
})

describe('401 и обновление токена', () => {
  it('обновляет токен и повторяет запрос с новым', async () => {
    httpFetch.mockResolvedValueOnce(json(401, { code: 'unauthorized', message: 'Требуется вход' })).mockResolvedValueOnce(json(200, { id: 7 }))
    refresh.mockResolvedValue('tok2')
    expect(await api.get('/me')).toEqual({ id: 7 })
    expect(httpFetch).toHaveBeenCalledTimes(2)
    expect(call(0)[1].headers.Authorization).toBe('Bearer tok1')
    expect(call(1)[1].headers.Authorization).toBe('Bearer tok2')
    expect(lost).not.toHaveBeenCalled()
  })

  it('если обновить нельзя, сообщает о потере сессии и отдаёт 401', async () => {
    httpFetch.mockResolvedValue(json(401, { code: 'unauthorized', message: 'Требуется вход' }))
    refresh.mockResolvedValue(null)
    await expect(api.get('/me')).rejects.toMatchObject({ status: 401, code: 'unauthorized' })
    expect(lost).toHaveBeenCalledTimes(1)
    expect(httpFetch).toHaveBeenCalledTimes(1)
  })

  it('повтор после обновления не зацикливается, если и он вернул 401', async () => {
    httpFetch.mockResolvedValue(json(401, { code: 'unauthorized', message: 'Требуется вход' }))
    refresh.mockResolvedValue('tok2')
    await expect(api.get('/me')).rejects.toMatchObject({ status: 401 })
    expect(httpFetch).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('несколько запросов с протухшим токеном делят один обмен', async () => {
    let calls = 0
    httpFetch.mockImplementation(async (_url, init) => {
      calls++
      const token = (init?.headers as Record<string, string> | undefined)?.Authorization
      return token === 'Bearer tok2' ? json(200, { ok: true }) : json(401, { code: 'unauthorized', message: '' })
    })
    refresh.mockImplementation(async () => {
      await Promise.resolve()
      return 'tok2'
    })
    const results = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')])
    expect(results).toHaveLength(3)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(calls).toBe(6)
  })

  it('другие ошибки не запускают обновление', async () => {
    httpFetch.mockResolvedValue(json(404, { code: 'not_found', message: 'Не найдено' }))
    await expect(api.get('/tasks/1')).rejects.toMatchObject({ status: 404 })
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('без настроенного адреса', () => {
  it('сообщает, что адрес не задан', async () => {
    configureClient({ getServer: () => null, getAccessToken: () => null, refreshAccessToken: async () => null, onSessionLost: lost })
    await expect(request('GET', '/me')).rejects.toMatchObject({ code: 'no_server' })
    expect(httpFetch).not.toHaveBeenCalled()
  })
})

describe('ошибка с телом', () => {
  it('сохраняет тело ответа: у 409 на вики там лежит актуальная версия страницы', async () => {
    const body = { code: 'conflict', message: 'Страницу изменил другой участник', current: { id: 'p1', rev: 4, md: 'Чужой текст' } }
    httpFetch.mockResolvedValue(json(409, body))
    const err = await api.patch('/wiki/p1', { rev: 3 }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 409, code: 'conflict', body })
  })
})

describe('файлы', () => {
  it('upload шлёт форму без своего Content-Type (границу частей ставит fetch) и ждёт дольше обычного', async () => {
    httpFetch.mockResolvedValue(json(201, [{ id: 'f1' }]))
    const form = new FormData()
    form.append('file', new Blob(['abc']), 'a.txt')
    const r = await api.upload<{ id: string }[]>('/files', form)
    expect(r).toEqual([{ id: 'f1' }])
    const [url, init] = call(0)
    expect(url).toBe('http://srv:8080/api/v1/files')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(form)
    expect(init.headers['Content-Type']).toBeUndefined()
    expect(init.headers.Authorization).toBe('Bearer tok1')
    expect((init as { timeoutMs?: number }).timeoutMs).toBeGreaterThan(60_000)
  })

  it('upload повторяет ту же форму после обновления токена', async () => {
    httpFetch.mockResolvedValueOnce(json(401, { code: 'unauthorized', message: '' })).mockResolvedValueOnce(json(201, []))
    refresh.mockResolvedValue('tok2')
    const form = new FormData()
    await api.upload('/files', form)
    expect(call(0)[1].body).toBe(form)
    expect(call(1)[1].body).toBe(form)
    expect(call(1)[1].headers.Authorization).toBe('Bearer tok2')
  })

  it('upload отдаёт ошибку сервера: файл больше лимита', async () => {
    httpFetch.mockResolvedValue(json(413, { code: 'payload_too_large', message: 'Файл «a.bin» больше допустимых 25 МБ' }))
    await expect(api.upload('/files', new FormData())).rejects.toMatchObject({ status: 413, code: 'payload_too_large' })
  })

  it('download отдаёт содержимое как есть и просит любой тип', async () => {
    httpFetch.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
    const blob = await api.download('/files/f1/download')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    expect(call(0)[1].headers.Accept).toBe('*/*')
  })

  it('download с 404 даёт ApiError', async () => {
    httpFetch.mockResolvedValue(json(404, { code: 'not_found', message: 'Не найдено' }))
    await expect(api.download('/files/x/download')).rejects.toMatchObject({ status: 404 })
  })
})

describe('связь с сервером', () => {
  afterEach(() => resetLink())

  it('запись в режиме «только просмотр» отклоняется сразу, без сети', async () => {
    useLink.setState({ down: true, readOnly: true })
    for (const send of [() => api.post('/tags', {}), () => api.patch('/tasks/1', {}), () => api.put('/docs/1/star', {}), () => api.delete('/tags/1'), () => api.upload('/files', new FormData())]) {
      await expect(send()).rejects.toBeInstanceOf(OfflineError)
    }
    expect(httpFetch).not.toHaveBeenCalled()
  })

  it('чтение в режиме «только просмотр» идёт как обычно', async () => {
    useLink.setState({ down: true, readOnly: true })
    httpFetch.mockResolvedValue(json(200, [1]))
    expect(await api.get('/tags')).toEqual([1])
    expect(httpFetch).toHaveBeenCalledTimes(1)
  })

  it('пока просмотр не включился (первые секунды без связи), запись пробует дойти', async () => {
    useLink.setState({ down: true, readOnly: false })
    httpFetch.mockResolvedValue(json(200, {}))
    await api.post('/tags', {})
    expect(httpFetch).toHaveBeenCalledTimes(1)
  })

  it('запрос, который не дошёл, сообщает: связи нет', async () => {
    httpFetch.mockRejectedValue(new NetworkError('Нет связи с сервером'))
    await expect(api.get('/tags')).rejects.toBeInstanceOf(NetworkError)
    expect(useLink.getState().down).toBe(true)
  })

  it('не вышло и обновить токен из-за связи: тоже «связи нет», вход не теряется', async () => {
    httpFetch.mockResolvedValue(json(401, { code: 'unauthorized', message: '' }))
    refresh.mockRejectedValue(new NetworkError('Нет связи с сервером'))
    await expect(api.get('/me')).rejects.toBeInstanceOf(NetworkError)
    expect(useLink.getState().down).toBe(true)
    expect(lost).not.toHaveBeenCalled()
  })

  it('прокси без сервера (502, 503, 504) — это «связи нет»', async () => {
    for (const status of [502, 503, 504]) {
      resetLink()
      httpFetch.mockResolvedValue(new Response('Bad Gateway', { status }))
      await expect(api.get('/tags')).rejects.toMatchObject({ status })
      expect(useLink.getState().down).toBe(true)
    }
  })

  it('любой ответ самого сервера, даже отказ, возвращает связь', async () => {
    linkLost()
    httpFetch.mockResolvedValue(json(404, { code: 'not_found', message: 'Не найдено' }))
    await expect(api.get('/tasks/1')).rejects.toMatchObject({ status: 404 })
    expect(useLink.getState().down).toBe(false)
  })

  it('isConnectionError: оборванный запрос, прокси и отказ записи — да, ответ сервера — нет', () => {
    expect(isConnectionError(new NetworkError('x'))).toBe(true)
    expect(isConnectionError(new OfflineError())).toBe(true)
    expect(isConnectionError(new ApiError(502, 'error', 'x'))).toBe(true)
    expect(isConnectionError(new ApiError(500, 'error', 'x'))).toBe(false)
    expect(isConnectionError(new ApiError(409, 'conflict', 'x'))).toBe(false)
    expect(isConnectionError(new Error('x'))).toBe(false)
  })
})
