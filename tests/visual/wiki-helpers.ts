// Общее для проверок вики: данные сервера напрямую (минуя интерфейс), открытие нужной страницы, ожидание сохранения.

import { expect, type Page } from '@playwright/test'
import { DEMO_TEAM, openApp, SERVER } from './fixtures'

export async function token(page: Page): Promise<string> {
  const res = await page.request.post(`${SERVER}/api/v1/auth/login`, { data: { email: 'lena@example.com', password: 'dev' } })
  return ((await res.json()) as { access_token: string }).access_token
}

export async function api<T>(page: Page, path: string, init: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; data?: unknown } = {}): Promise<T> {
  const res = await page.request.fetch(`${SERVER}/api/v1${path}`, {
    method: init.method ?? 'GET',
    data: init.data,
    headers: { Authorization: `Bearer ${await token(page)}` },
  })
  expect(res.ok(), `${init.method ?? 'GET'} ${path}: ${res.status()}`).toBeTruthy()
  return res.status() === 204 ? (undefined as T) : ((await res.json()) as T)
}

/** Общая команда демо-данных «Dream Team»: в ней вики, файлы, папки и проекты макета */
export const dreamTeam = async (page: Page): Promise<string> =>
  (await api<Array<{ id: string; name: string }>>(page, '/teams')).find((t) => t.name === DEMO_TEAM)!.id

/** «Web-приложение»: первый проект, в нём лежат демо-документы, ссылки и лента (документы и ссылки принадлежат проекту) */
export const webProjectId = async (page: Page): Promise<string> =>
  (await api<Array<{ id: string; key: string | null }>>(page, '/projects')).find((p) => p.key === 'WEB')!.id

export type WikiNode = { id: string; title: string; parent_id: string | null; rev: number }
export type WikiFull = WikiNode & { md: string }
export type LibraryFile = { id: string; name: string; kind: string; size_bytes: number; folder_id: string | null; wiki_page_id: string | null; task_id: string | null }
export type Library = { total: number; files: LibraryFile[] }
export type FolderRow = { id: string; name: string; file_count: number }

export const wikiNodes = async (page: Page) => api<WikiNode[]>(page, `/teams/${await dreamTeam(page)}/wiki`)
export const wikiPage = (page: Page, id: string) => api<WikiFull>(page, `/wiki/${id}`)
export const library = async (page: Page) => api<Library>(page, `/teams/${await dreamTeam(page)}/files`)
export const folders = async (page: Page) => api<FolderRow[]>(page, `/teams/${await dreamTeam(page)}/folders`)

export async function idOf(page: Page, title: string): Promise<string> {
  const node = (await wikiNodes(page)).find((n) => n.title === title)
  expect(node, `страница «${title}»`).toBeTruthy()
  return node!.id
}

/** Страница с нужным текстом, созданная напрямую в базе: так сценарий не зависит от остальных частей интерфейса */
export async function makePage(page: Page, title: string, md: string, parent: string | null = null): Promise<string> {
  return (await api<WikiFull>(page, `/teams/${await dreamTeam(page)}/wiki`, { method: 'POST', data: { title, md, parent_id: parent } })).id
}

/** Открывает вики сразу на нужной странице: так человек возвращается к последней открытой */
export async function openPageById(page: Page, id: string, theme: 'light' | 'dark' = 'light') {
  await openApp(page, { theme, settings: { page: 'wiki', wikiPage: id } })
  await expect(page.getByLabel('Название страницы')).toBeVisible()
}

export async function openWiki(page: Page, title: string, theme: 'light' | 'dark' = 'light') {
  const id = await idOf(page, title)
  await openPageById(page, id, theme)
  return id
}

/** Ждёт, пока текст страницы на сервере станет таким (сохранение идёт с задержкой) */
export async function expectSaved(page: Page, id: string, md: string) {
  await expect.poll(async () => (await wikiPage(page, id)).md, { timeout: 6000 }).toBe(md)
}

export const blocks = (page: Page) => page.locator('.md .mv')
export const editor = (page: Page) => page.locator('textarea.md-ta')
