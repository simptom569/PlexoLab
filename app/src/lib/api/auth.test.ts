import { beforeEach, describe, expect, it, vi } from 'vitest'

// Сеть подменяем: проверяем, что клиент отправляет и как читает ответы без токена
const httpFetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
vi.mock('../platform/http', () => ({
  httpFetch: (url: string, init?: RequestInit) => httpFetch(url, init),
  NetworkError: class NetworkError extends Error {},
}))

import { fetchOptions, register, requestRegisterCode, requestResetCode, resetPassword } from './auth'
import { ApiError } from './client'

const SERVER = 'http://srv:8080'
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const lastBody = () => JSON.parse(String(httpFetch.mock.calls.at(-1)?.[1]?.body))
const lastCall = () => ({ url: httpFetch.mock.calls.at(-1)?.[0], method: httpFetch.mock.calls.at(-1)?.[1]?.method })

beforeEach(() => httpFetch.mockReset())

describe('возможности сервера', () => {
  it('читает, настроена ли почта', async () => {
    httpFetch.mockResolvedValue(json(200, { registration: true, password_reset: true }))
    expect(await fetchOptions(SERVER)).toEqual({ registration: true, password_reset: true })
    expect(httpFetch.mock.calls[0][0]).toBe(`${SERVER}/api/v1/auth/options`)
  })

  it('почта не настроена: ссылок не будет', async () => {
    httpFetch.mockResolvedValue(json(200, { registration: false, password_reset: false }))
    expect(await fetchOptions(SERVER)).toEqual({ registration: false, password_reset: false })
  })

  it('старый сервер без этой ручки, ошибка сервера, обрыв связи и мусор в ответе дают «нельзя»', async () => {
    const none = { registration: false, password_reset: false }
    httpFetch.mockResolvedValueOnce(json(404, { code: 'not_found', message: 'Не найдено' }))
    expect(await fetchOptions(SERVER)).toEqual(none)
    httpFetch.mockResolvedValueOnce(json(503, { code: 'x', message: 'x' }))
    expect(await fetchOptions(SERVER)).toEqual(none)
    httpFetch.mockRejectedValueOnce(new Error('offline'))
    expect(await fetchOptions(SERVER)).toEqual(none)
    httpFetch.mockResolvedValueOnce(new Response('<html>не сервер</html>', { status: 200 }))
    expect(await fetchOptions(SERVER)).toEqual(none)
    httpFetch.mockResolvedValueOnce(json(200, { registration: 'yes', password_reset: 1 }))
    expect(await fetchOptions(SERVER)).toEqual(none)
  })

  it('регистрация и сброс включаются независимо', async () => {
    httpFetch.mockResolvedValue(json(200, { registration: false, password_reset: true }))
    expect(await fetchOptions(SERVER)).toEqual({ registration: false, password_reset: true })
  })
})

describe('запросы регистрации и сброса пароля', () => {
  it('шаг 1: адрес уходит на нужную ручку, ответ 204 пустой', async () => {
    httpFetch.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(requestRegisterCode(SERVER, 'lena@example.com')).resolves.toBeUndefined()
    expect(lastCall()).toEqual({ url: `${SERVER}/api/v1/auth/register/code`, method: 'POST' })
    expect(lastBody()).toEqual({ email: 'lena@example.com' })

    await requestResetCode(SERVER, 'lena@example.com')
    expect(lastCall().url).toBe(`${SERVER}/api/v1/auth/password-reset/code`)
    expect(lastBody()).toEqual({ email: 'lena@example.com' })
  })

  it('шаг 2 регистрации: все поля уходят как их ждёт сервер, ответ — пара токенов', async () => {
    const tokens = { access_token: 'a', refresh_token: 'r' }
    httpFetch.mockResolvedValue(json(201, tokens))
    expect(await register(SERVER, 'lena@example.com', '123456', 'Лена М.', 'long-password')).toEqual(tokens)
    expect(lastCall().url).toBe(`${SERVER}/api/v1/auth/register`)
    expect(lastBody()).toEqual({ email: 'lena@example.com', code: '123456', name: 'Лена М.', password: 'long-password' })
  })

  it('шаг 2 сброса: новый пароль уходит в поле new_password', async () => {
    httpFetch.mockResolvedValue(json(200, { access_token: 'a', refresh_token: 'r' }))
    await resetPassword(SERVER, 'lena@example.com', '654321', 'brand-new-password')
    expect(lastCall().url).toBe(`${SERVER}/api/v1/auth/password-reset`)
    expect(lastBody()).toEqual({ email: 'lena@example.com', code: '654321', new_password: 'brand-new-password' })
  })

  it('ошибки сервера приходят как ApiError с кодом и текстом для человека', async () => {
    httpFetch.mockResolvedValue(json(400, { code: 'wrong_code', message: 'Неверный код. Осталось попыток: 4' }))
    const err = await register(SERVER, 'lena@example.com', '000000', 'Лена', 'long-password').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 400, code: 'wrong_code', message: 'Неверный код. Осталось попыток: 4' })

    httpFetch.mockResolvedValue(json(429, { code: 'too_many_requests', message: 'Письмо уже отправлено. Новое можно запросить через минуту' }))
    await expect(requestRegisterCode(SERVER, 'lena@example.com')).rejects.toMatchObject({ status: 429, code: 'too_many_requests' })

    httpFetch.mockResolvedValue(json(503, { code: 'mail_disabled', message: 'Регистрация и сброс пароля по почте на этом сервере не настроены' }))
    await expect(requestResetCode(SERVER, 'lena@example.com')).rejects.toMatchObject({ status: 503, code: 'mail_disabled' })
  })
})
