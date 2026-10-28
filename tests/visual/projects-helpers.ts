import { expect, type Browser, type Page } from '@playwright/test'
import { DEMO_TEAM, openApp, SERVER } from './fixtures'

// Общее для проверок проектов и ключей: запросы к серверу от имени любого человека и второй браузер.

type Init = { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; data?: unknown }

/** Запрос к серверу от имени человека, минуя интерфейс */
export async function apiAs<T>(page: Page, email: string, path: string, init: Init = {}): Promise<T> {
  const login = await page.request.post(`${SERVER}/api/v1/auth/login`, { data: { email, password: 'dev' } })
  const { access_token } = (await login.json()) as { access_token: string }
  const res = await page.request.fetch(`${SERVER}/api/v1${path}`, {
    method: init.method ?? 'GET',
    data: init.data,
    headers: { Authorization: `Bearer ${access_token}` },
  })
  expect(res.ok(), `${init.method ?? 'GET'} ${path}: ${res.status()}`).toBeTruthy()
  return res.status() === 204 ? (undefined as T) : ((await res.json()) as T)
}

/** Общая команда демо-данных «Dream Team» глазами этого человека: в ней проекты макета, новые проекты теста создаются тоже в ней */
export async function dreamTeamAs(page: Page, email: string): Promise<string> {
  const teams = await apiAs<Array<{ id: string; name: string }>>(page, email, '/teams')
  return teams.find((t) => t.name === DEMO_TEAM)!.id
}

export type ApiProject = { id: string; name: string; key: string | null; color: string; role: string; archived: boolean }
export const projectsOf = (page: Page, email: string) => apiAs<ApiProject[]>(page, email, '/projects')

/** Второй человек в отдельном окне браузера, с живыми обновлениями */
export async function secondClient(
  browser: Browser,
  email: string,
  theme: 'light' | 'dark' = 'light',
  settings: Record<string, unknown> = {},
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU', timezoneId: 'UTC', reducedMotion: 'reduce' })
  const page = await context.newPage()
  await openApp(page, { email, theme, settings })
  return { page, close: () => context.close() }
}

/** Только код ответа сервера на запрос от имени человека: для проверок «нет доступа» */
export async function statusAs(page: Page, email: string, path: string, init: Init = {}): Promise<number> {
  const login = await page.request.post(`${SERVER}/api/v1/auth/login`, { data: { email, password: 'dev' } })
  const { access_token } = (await login.json()) as { access_token: string }
  const res = await page.request.fetch(`${SERVER}/api/v1${path}`, {
    method: init.method ?? 'GET',
    data: init.data,
    headers: { Authorization: `Bearer ${access_token}` },
  })
  return res.status()
}
