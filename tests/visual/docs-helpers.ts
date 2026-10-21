// Общее для проверок документов: данные сервера напрямую (минуя интерфейс), открытие списка и документа.

import { expect, type Page } from '@playwright/test'
import { openApp } from './fixtures'
import { api, webProjectId } from './wiki-helpers'

export type DocObject = { id: string; type: string; x: number; y: number; w: number; h: number; text: string; color: number }
export type DocRow = {
  id: string
  title: string
  md: string
  mode: 'page' | 'edge'
  note: { x: number; y: number; w: number }
  rev: number
  canvas_rev: number
  starred: boolean
  objects: DocObject[]
  links: Array<{ a: string; b: string }>
}
export type DocSummary = { id: string; title: string; snippet: string; mode: 'page' | 'edge'; starred: boolean; object_count: number; position: number }

export const docSummaries = async (page: Page) => api<DocSummary[]>(page, `/projects/${await webProjectId(page)}/docs`)
export const docFull = (page: Page, id: string) => api<DocRow>(page, `/docs/${id}`)

export async function docId(page: Page, title: string): Promise<string> {
  const doc = (await docSummaries(page)).find((d) => d.title === title)
  expect(doc, `документ «${title}»`).toBeTruthy()
  return doc!.id
}

/** Документ, созданный напрямую на сервере: так сценарий не зависит от остальных частей интерфейса */
export async function makeDoc(page: Page, title: string, mode: 'page' | 'edge' = 'page', md = ''): Promise<string> {
  return (await api<DocRow>(page, `/projects/${await webProjectId(page)}/docs`, { method: 'POST', data: { title, mode, md } })).id
}

/** Названия документов в порядке сервера */
export const orderOnServer = async (page: Page) => (await docSummaries(page)).map((d) => d.title)

export async function openDocs(page: Page, theme: 'light' | 'dark' = 'light', settings: Record<string, unknown> = {}) {
  await openApp(page, { theme, settings: { page: 'docs', ...settings } })
  await expect(page.getByRole('heading', { name: 'Документы', level: 1 })).toBeVisible()
}

/** Открывает документ сразу, как будто человек вернулся к последнему открытому */
export async function openDoc(page: Page, id: string, theme: 'light' | 'dark' = 'light') {
  await openApp(page, { theme, settings: { page: 'docs', docOpen: id } })
  await expect(page.getByLabel('Название документа')).toBeVisible()
}

export async function openDocByTitle(page: Page, title: string, theme: 'light' | 'dark' = 'light') {
  const id = await docId(page, title)
  await openDoc(page, id, theme)
  return id
}

/** Ждёт, пока холст на сервере станет таким (сохранение идёт с задержкой) */
export async function expectCanvas<T>(page: Page, id: string, pick: (doc: DocRow) => T, expected: T) {
  await expect.poll(async () => pick(await docFull(page, id)), { timeout: 6000 }).toEqual(expected)
}

export const cards = (page: Page) => page.locator('.dgrid .dcard')
export const cardTitles = (page: Page) => page.locator('.dgrid .dcard .dcard-title')
export const items = (page: Page) => page.locator('.cv .wb-item')
