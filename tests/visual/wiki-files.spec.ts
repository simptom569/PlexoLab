// Файлы: вложения страницы вики и задач, библиотека, папки, загрузка, скачивание, лимит размера.

import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { openApp, resetData } from './fixtures'
import { api, folders, library, openWiki } from './wiki-helpers'

test.beforeEach(() => resetData())

const png = (name: string, text = 'PNGDATA') => ({ name, mimeType: 'image/png', buffer: Buffer.from(text) })
const pageFilesPanel = (page: Page) => page.getByRole('region', { name: 'Файлы страницы' })
const confirmDelete = async (row: ReturnType<Page['locator']>) => {
  await row.getByRole('button', { name: 'Удалить' }).click()
  await row.getByRole('button', { name: 'Точно удалить?' }).click()
}

test.describe('файлы страницы', () => {
  test('у страницы без файлов видна подсказка и нулевой счётчик', async ({ page }) => {
    await openWiki(page, 'Соглашения по коду')
    const panel = pageFilesPanel(page)
    await expect(panel).toContainText('К странице пока ничего не прикреплено')
    await expect(panel.locator('.pill')).toHaveText('0')
  })

  test('прикрепленный файл появляется в списке и попадает в папку «Вложения»', async ({ page }) => {
    const id = await openWiki(page, 'Соглашения по коду')
    const before = await library(page)
    const attachments = (await folders(page)).find((f) => f.name === 'Вложения')!

    await pageFilesPanel(page).locator('input[type=file]').setInputFiles(png('схема.png'))
    const row = pageFilesPanel(page).locator('.file-row')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('схема.png')
    // часы браузера в тестах заморожены на 18 октября, а сервер ставит настоящее время загрузки: «сегодня» или дата
    await expect(row).toContainText(/Изображение · 1 КБ · (сегодня|\d+ [а-я]{3,4})/)
    await expect(row.locator('.ft')).toHaveText('PNG')
    await expect(pageFilesPanel(page).locator('.pill')).toHaveText('1')
    await expect(page.locator('.tree .nav .count')).toHaveText(String(before.total + 1))

    const after = await library(page)
    const file = after.files.find((f) => f.name === 'схема.png')!
    expect(file).toMatchObject({ wiki_page_id: id, folder_id: attachments.id, kind: 'img', size_bytes: 7 })
    expect((await folders(page)).find((f) => f.name === 'Вложения')!.file_count).toBe(attachments.file_count + 1)
  })

  test('несколько файлов за раз', async ({ page }) => {
    await openWiki(page, 'Соглашения по коду')
    await pageFilesPanel(page).locator('input[type=file]').setInputFiles([png('а.png'), png('б.png'), { name: 'в.pdf', mimeType: 'application/pdf', buffer: Buffer.from('PDF') }])
    await expect(pageFilesPanel(page).locator('.file-row')).toHaveCount(3)
    await expect(pageFilesPanel(page).locator('.pill')).toHaveText('3')
  })

  test('файл скачивается с тем же именем и содержимым', async ({ page }) => {
    await openWiki(page, 'Соглашения по коду')
    await pageFilesPanel(page).locator('input[type=file]').setInputFiles(png('загрузка.png', 'СОДЕРЖИМОЕ ФАЙЛА'))
    const [download] = await Promise.all([page.waitForEvent('download'), pageFilesPanel(page).getByRole('button', { name: 'загрузка.png' }).click()])
    expect(download.suggestedFilename()).toBe('загрузка.png')
    expect(readFileSync((await download.path())!, 'utf8')).toBe('СОДЕРЖИМОЕ ФАЙЛА')
  })

  test('удаление в два шага убирает файл из страницы и библиотеки', async ({ page }) => {
    await openWiki(page, 'Соглашения по коду')
    await pageFilesPanel(page).locator('input[type=file]').setInputFiles(png('лишний.png'))
    const row = pageFilesPanel(page).locator('.file-row')
    await expect(row).toHaveCount(1)
    const total = (await library(page)).total
    await confirmDelete(row)
    await expect(row).toHaveCount(0)
    await expect(pageFilesPanel(page)).toContainText('К странице пока ничего не прикреплено')
    await expect.poll(async () => (await library(page)).total).toBe(total - 1)
  })

  test('у страницы из сида показаны её файлы, «Открыть библиотеку» ведёт в библиотеку', async ({ page }) => {
    await openWiki(page, 'Разработка')
    await expect(pageFilesPanel(page).locator('.file-row')).toHaveCount(2)
    await expect(pageFilesPanel(page).locator('.file-row').first()).toContainText('Изображение · 184 КБ')
    await expect(pageFilesPanel(page).locator('.file-row').nth(1)).toContainText('PDF · 1.2 МБ')
    await pageFilesPanel(page).getByRole('button', { name: 'Открыть библиотеку' }).click()
    await expect(page.getByRole('heading', { name: 'Файлы', exact: true })).toBeVisible()
    await expect(page.locator('.tree .nav.on')).toBeVisible()
  })

  test('файл больше лимита не загружается, показана плашка', async ({ page }) => {
    await openWiki(page, 'Соглашения по коду')
    const total = (await library(page)).total
    // в тестовом сервере лимит один мегабайт
    await pageFilesPanel(page).locator('input[type=file]').setInputFiles({ name: 'огромный.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(2 * 1024 * 1024) })
    await expect(page.getByText('Не удалось загрузить файлы')).toBeVisible()
    await expect(pageFilesPanel(page).locator('.file-row')).toHaveCount(0)
    expect((await library(page)).total).toBe(total)
  })

  test('файл из примера без содержимого не скачивается, показана плашка', async ({ page }) => {
    await openWiki(page, 'Разработка')
    await pageFilesPanel(page).locator('.file-row').first().getByRole('button').first().click()
    await expect(page.getByText('Не удалось скачать файл')).toBeVisible()
  })
})

test.describe('библиотека', () => {
  async function openLibrary(page: Page) {
    await openWiki(page, 'Соглашения по коду')
    await page.getByRole('button', { name: /^Файлы/ }).click()
    await expect(page.getByRole('heading', { name: 'Файлы', exact: true })).toBeVisible()
  }

  test('в корне папки и файлы вне папок, у папок число файлов', async ({ page }) => {
    await openLibrary(page)
    await expect(page.locator('.folder .open')).toHaveText(['Дизайн2 файла', 'Договорённости2 файла', 'Скриншоты1 файл', 'Вложения3 файла'])
    await expect(page.locator('.frow')).toHaveCount(1)
    await expect(page.locator('.frow')).toContainText('метрики-q3.xlsx')
    await expect(page.locator('.frow')).toContainText('Корень')
    await expect(page.locator('.tree .nav .count')).toHaveText('9')
  })

  test('папка открывается, показывает свои файлы и ведёт обратно по крошке', async ({ page }) => {
    await openLibrary(page)
    await page.locator('.folder .open', { hasText: 'Вложения' }).click()
    await expect(page.locator('.sheet .frow')).toHaveCount(3)
    await expect(page.locator('.sheet .frow').first()).toContainText('Страница «')
    await expect(page.locator('.crumb')).toContainText('Все файлы/Вложения')
    await expect(page.getByPlaceholder('Новая папка')).toHaveCount(0)
    await expect(page.locator('.folder')).toHaveCount(0)
    await page.getByRole('button', { name: 'Все файлы' }).click()
    await expect(page.locator('.folder')).toHaveCount(4)
  })

  test('«Открыть» у файла страницы переходит на страницу', async ({ page }) => {
    await openLibrary(page)
    await page.locator('.folder .open', { hasText: 'Вложения' }).click()
    await page.locator('.frow').first().getByRole('button', { name: 'Открыть' }).click()
    await expect(page.getByLabel('Название страницы')).toBeVisible()
  })

  test('тип файла и поиск ищут во всех папках сразу', async ({ page }) => {
    await openLibrary(page)
    await page.getByRole('button', { name: 'PDF', exact: true }).click()
    await expect(page.locator('.folder')).toHaveCount(0)
    await expect(page.locator('.frow .ft')).toHaveText(['PDF', 'PDF'])
    await page.getByRole('button', { name: 'Все', exact: true }).click()
    await page.getByPlaceholder('Поиск файлов').fill('SSO')
    await expect(page.locator('.frow')).toHaveCount(1)
    await expect(page.locator('.frow')).toContainText('sso-flow.png')
    await page.getByPlaceholder('Поиск файлов').fill('нет такого')
    await expect(page.locator('.sheet')).toContainText('Файлов нет. Загрузи первые кнопкой справа вверху')
  })

  test('загрузка в корень и в открытую папку', async ({ page }) => {
    await openLibrary(page)
    await page.locator('.head input[type=file]').setInputFiles(png('корневой.png'))
    await expect(page.locator('.frow', { hasText: 'корневой.png' })).toContainText('Корень')

    await page.locator('.folder .open', { hasText: 'Дизайн' }).click()
    await page.locator('.head input[type=file]').setInputFiles(png('в-папке.png'))
    await expect(page.locator('.frow', { hasText: 'в-папке.png' })).toContainText('Папка «Дизайн»')
    const lib = await library(page)
    const design = (await folders(page)).find((f) => f.name === 'Дизайн')!
    expect(lib.files.find((f) => f.name === 'в-папке.png')!.folder_id).toBe(design.id)
    expect(lib.files.find((f) => f.name === 'корневой.png')!.folder_id).toBeNull()
  })

  test('новая папка: создаётся по Enter и кнопке, повтор названия игнорируется, пустую можно удалить', async ({ page }) => {
    await openLibrary(page)
    const input = page.getByPlaceholder('Новая папка')
    await input.fill('Отчёты')
    await input.press('Enter')
    await expect(page.locator('.folder')).toHaveCount(5)
    await expect(page.locator('.folder').last()).toContainText('Отчёты0 файлов')
    await expect(input).toHaveValue('')

    await input.fill('Отчёты')
    await page.getByRole('button', { name: 'Создать' }).click()
    await expect(page.locator('.folder')).toHaveCount(5)

    // «Удалить» есть только у пустой папки
    await expect(page.locator('.folder').first().getByRole('button', { name: 'Удалить' })).toHaveCount(0)
    await confirmDelete(page.locator('.folder').last())
    await expect(page.locator('.folder')).toHaveCount(4)
    expect((await folders(page)).map((f) => f.name)).not.toContain('Отчёты')
  })

  test('файл из библиотеки скачивается и удаляется в два шага', async ({ page }) => {
    await openLibrary(page)
    await page.locator('.head input[type=file]').setInputFiles(png('временный.png', 'ДАННЫЕ'))
    const row = page.locator('.frow', { hasText: 'временный.png' })
    await expect(row).toBeVisible()
    const [download] = await Promise.all([page.waitForEvent('download'), row.getByRole('button', { name: 'временный.png' }).click()])
    expect(download.suggestedFilename()).toBe('временный.png')
    expect(readFileSync((await download.path())!, 'utf8')).toBe('ДАННЫЕ')

    await confirmDelete(row)
    await expect(row).toHaveCount(0)
    await expect.poll(async () => (await library(page)).files.some((f) => f.name === 'временный.png')).toBe(false)
  })

  test('в сводке у файла видно, кто загрузил: аватар с подписью', async ({ page }) => {
    await openLibrary(page)
    await expect(page.locator('.frow .avatar').first()).toHaveAttribute('aria-label', 'Игорь П.')
  })
})

test.describe('вложения задачи', () => {
  const drawer = (page: Page) => page.getByRole('dialog', { name: /^Задача / })

  async function openTask(page: Page) {
    await openApp(page, { settings: { page: 'board' } })
    await page.locator('[data-card-id]', { hasText: 'WEB-144' }).locator('.card-title').click()
    await expect(drawer(page).getByRole('heading', { name: /Вложения/ })).toBeVisible()
  }

  /** Раздел «Вложения» панели: заголовок и список лежат рядом в одном блоке */
  const attachments = (page: Page) => drawer(page).locator('div', { has: page.getByRole('heading', { name: /Вложения/ }) }).last()

  test('файл прикрепляется, скачивается и убирается', async ({ page }) => {
    await openTask(page)
    const section = attachments(page)
    const rows = section.locator('.file-row')
    await expect(rows).toHaveCount(1) // sso-flow.png из сида

    await section.locator('input[type=file]').setInputFiles(png('в-задачу.png', 'ЗАДАЧА'))
    await expect(rows).toHaveCount(2)
    await expect(rows.last()).toContainText('в-задачу.png')

    const [download] = await Promise.all([page.waitForEvent('download'), rows.last().getByRole('button', { name: 'в-задачу.png' }).click()])
    expect(readFileSync((await download.path())!, 'utf8')).toBe('ЗАДАЧА')

    // в библиотеку вики вложения задач не попадают
    expect((await library(page)).files.some((f) => f.name === 'в-задачу.png')).toBe(false)

    await rows.last().getByRole('button', { name: 'Убрать файл' }).click()
    await expect(rows).toHaveCount(1)
    await expect.poll(async () => (await api<{ files: unknown[] }>(page, '/tasks/' + (await taskId(page, 'WEB-144')))).files.length).toBe(1)
  })

  test('файл больше лимита не прикрепляется, показана плашка', async ({ page }) => {
    await openTask(page)
    const section = attachments(page)
    await section.locator('input[type=file]').setInputFiles({ name: 'огромный.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(2 * 1024 * 1024) })
    await expect(page.getByText('Не удалось загрузить файлы')).toBeVisible()
    await expect(section.locator('.file-row')).toHaveCount(1)
  })
})

async function taskId(page: Page, key: string): Promise<string> {
  const projects = await api<Array<{ id: string; name: string }>>(page, '/projects')
  const board = await api<{ tasks: Array<{ id: string; key: string }> }>(page, `/projects/${projects.find((p) => p.name === 'Web-приложение')!.id}/board`)
  return board.tasks.find((t) => t.key === key)!.id
}
