import { expect, test, type Page } from '@playwright/test'
import { cutOffAndWait } from './offline-helpers'
import { openApp, resetData, SERVER } from './fixtures'
import { api, token } from './wiki-helpers'

// Этап Н4 (docs/OFFLINE-NOTIFY-SEARCH.md, раздел 3): окно «Поиск» по Ctrl+K и из меню пользователя. Ищет по названиям
// задач (и их id), документов, страниц вики и файлов, только в доступном. Содержимое не ищется.

test.beforeEach(() => resetData())

const card = (page: Page, key: string) => page.locator('[data-card-id]', { hasText: key })
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Поиск' })
const box = (page: Page) => dialog(page).getByRole('combobox', { name: 'Поиск по названиям' })
const options = (page: Page) => dialog(page).getByRole('option')
const drawer = (page: Page) => page.getByRole('dialog', { name: /^Задача / })
const userButton = (page: Page) => page.locator('.side button[aria-haspopup="menu"]')

type Project = { id: string; key: string | null; name: string }
const projectByKey = async (page: Page, key: string) => (await api<Project[]>(page, '/projects')).find((p) => p.key === key)!

/** Всё, что находится по слову «поиск-тест»: по одной записи каждого вида */
async function seedFindable(page: Page) {
  const web = await projectByKey(page, 'WEB')
  const task = await api<{ id: string; key: string }>(page, `/projects/${web.id}/tasks`, { method: 'POST', data: { title: 'Поиск-тест: задача' } })
  const doc = await api<{ id: string }>(page, `/projects/${web.id}/docs`, { method: 'POST', data: { title: 'Поиск-тест: документ', md: 'Спрятанное слово' } })
  const wiki = await api<{ id: string }>(page, '/wiki', { method: 'POST', data: { title: 'Поиск-тест: страница', md: '' } })
  const res = await page.request.post(`${SERVER}/api/v1/files`, {
    headers: { Authorization: `Bearer ${await token(page)}` },
    multipart: { file: { name: 'поиск-тест-файл.txt', mimeType: 'text/plain', buffer: Buffer.from('1') } },
  })
  expect(res.ok()).toBeTruthy()
  return { task, doc, wiki, web }
}

async function openSearch(page: Page) {
  await page.keyboard.press('Control+k')
  await expect(dialog(page)).toBeVisible()
}

async function type(page: Page, text: string) {
  await box(page).fill(text)
}

// ===== Как открыть =====

test.describe('вход в поиск', () => {
  test('Ctrl+K открывает окно с курсором в поле и подсказкой, повторное нажатие и Esc закрывают', async ({ page }) => {
    await openApp(page)
    await expect(card(page, 'WEB-141')).toBeVisible()
    await openSearch(page)
    await expect(box(page)).toBeFocused()
    await expect(dialog(page)).toContainText('Начните печатать')
    await page.keyboard.press('Control+k')
    await expect(dialog(page)).toHaveCount(0)

    await openSearch(page)
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
  })

  test('работает и на русской раскладке: узнаётся по коду клавиши, а не по букве', async ({ page }) => {
    await openApp(page)
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'л', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true })))
    await expect(dialog(page)).toBeVisible()
    // а с Shift или Alt это уже другое сочетание
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+Shift+K')
    await page.keyboard.press('Alt+Control+k')
    await expect(dialog(page)).toHaveCount(0)
  })

  test('пункт «Поиск» в меню пользователя с подсказкой клавиш', async ({ page }) => {
    await openApp(page)
    await userButton(page).click()
    const item = page.getByRole('menuitem', { name: /^Поиск/ })
    await expect(item).toContainText('Ctrl+K')
    await item.click()
    await expect(dialog(page)).toBeVisible()
    await expect(box(page)).toBeFocused()
  })

  test('Ctrl+K работает и пока курсор в поле другого места, например в комментарии', async ({ page }) => {
    await openApp(page)
    await card(page, 'WEB-141').locator('.card-title').click()
    await drawer(page).getByLabel('Комментарий').click()
    await page.keyboard.press('Control+k')
    await expect(dialog(page)).toBeVisible()
  })
})

// ===== Рамка фокуса =====

test('у полей поиска одна рамка фокуса: плашка цвета акцента, а вокруг самого input второй рамки нет', async ({ page }) => {
  await openApp(page)
  await expect(card(page, 'WEB-141')).toBeVisible()
  // поле поиска доски (то же правило, что и у окна «Поиск»)
  const board = page.getByPlaceholder('Поиск по задачам')
  await board.focus()
  await expect(board).toHaveCSS('outline-style', 'none')
  await expect(board.locator('xpath=..')).toHaveCSS('border-top-color', 'rgb(51, 85, 224)') // --accent светлой темы

  await openSearch(page)
  await expect(box(page)).toBeFocused()
  await expect(box(page)).toHaveCSS('outline-style', 'none')
  await expect(dialog(page).locator('label.search')).toHaveCSS('border-top-color', 'rgb(51, 85, 224)')
  // а у остальных полей приложения рамка фокуса прежняя
  await page.keyboard.press('Escape')
  await card(page, 'WEB-141').locator('.card-title').click()
  await drawer(page).getByLabel('Комментарий').focus()
  await expect(drawer(page).getByLabel('Комментарий')).toHaveCSS('outline-style', 'solid')
})

// ===== Что находит =====

test.describe('результаты', () => {
  test('по части названия задачи без учёта регистра: id, название и проект', async ({ page }) => {
    await openApp(page)
    await openSearch(page)
    await type(page, 'ЭКСПОРТ')
    await expect(options(page)).toHaveCount(1)
    await expect(options(page).first()).toContainText('WEB-151')
    await expect(options(page).first()).toContainText('Экспорт отчёта в CSV')
    await expect(options(page).first()).toContainText('Web-приложение')
    await expect(dialog(page).getByRole('group', { name: 'Задачи' })).toBeVisible()
  })

  test('по id задачи: целиком и частью', async ({ page }) => {
    await openApp(page)
    await openSearch(page)
    await type(page, 'web-141')
    await expect(options(page)).toHaveCount(1)
    await expect(options(page).first()).toContainText('Тёмная тема для страницы настроек')
    await type(page, 'WEB-14')
    await expect.poll(() => options(page).count()).toBeGreaterThan(1) // ответ приходит чуть позже набранного
    await expect(options(page).first()).toContainText('WEB-14')
  })

  test('четыре вида в своих группах: задачи, документы, вики, файлы; содержимое не ищется', async ({ page }) => {
    await openApp(page)
    await seedFindable(page)
    await openSearch(page)
    await type(page, 'поиск-тест')
    for (const group of ['Задачи', 'Документы', 'Вики', 'Файлы']) await expect(dialog(page).getByRole('group', { name: group })).toBeVisible()
    await expect(options(page)).toHaveCount(4)
    await expect(options(page).nth(0)).toContainText('Поиск-тест: задача')
    await expect(options(page).nth(1)).toContainText('Поиск-тест: документ')
    await expect(options(page).nth(1)).toContainText('Web-приложение')
    await expect(options(page).nth(2)).toContainText('Поиск-тест: страница')
    await expect(options(page).nth(2)).toContainText('Вики')
    await expect(options(page).nth(3)).toContainText('поиск-тест-файл.txt')
    await expect(options(page).nth(3)).toContainText('Файлы')

    await type(page, 'спрятанное')
    await expect(dialog(page)).toContainText('Ничего не найдено') // слово есть только в тексте документа
  })

  test('нечего показать: подсказка до ввода, «Ничего не найдено» после, пробелы не ищутся', async ({ page }) => {
    await openApp(page)
    await openSearch(page)
    await type(page, '   ')
    await expect(dialog(page)).toContainText('Начните печатать')
    await type(page, 'яяяяя')
    await expect(dialog(page)).toContainText('Ничего не найдено')
    await type(page, '')
    await expect(dialog(page)).toContainText('Начните печатать')
  })

  test('задачи чужого проекта не находятся (Артём не участник), а в своих проектах находятся', async ({ page, browser }) => {
    await openApp(page) // Лена: глобальный администратор, видит все проекты
    const secret = await api<{ id: string }>(page, '/projects', { method: 'POST', data: { name: 'Закрытый проект' } })
    await api(page, `/projects/${secret.id}/tasks`, { method: 'POST', data: { title: 'Тайная задача' } })
    const api2 = await projectByKey(page, 'API')
    await api(page, `/projects/${api2.id}/tasks`, { method: 'POST', data: { title: 'Задача мобильного для поиска' } })

    await openSearch(page)
    await type(page, 'тайная')
    await expect(options(page)).toHaveCount(1) // Лена видит всё
    await page.keyboard.press('Escape')

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU', timezoneId: 'UTC', reducedMotion: 'reduce' })
    const artem = await context.newPage()
    try {
      await openApp(artem, { email: 'artem@example.com' })
      await openSearch(artem)
      await type(artem, 'тайная')
      await expect(dialog(artem)).toContainText('Ничего не найдено')
      await type(artem, 'мобильного для поиска')
      await expect(options(artem)).toHaveCount(1)
      await expect(options(artem).first()).toContainText('Мобильный API')
    } finally {
      await context.close()
    }
  })
})

// ===== Выбор и открытие =====

test.describe('выбор и открытие', () => {
  test('стрелки двигают выбор по кругу, указатель тоже, Enter открывает выбранную строку', async ({ page }) => {
    await openApp(page)
    await seedFindable(page)
    await openSearch(page)
    await type(page, 'поиск-тест')
    await expect(options(page)).toHaveCount(4)
    await expect(options(page).nth(0)).toHaveAttribute('aria-selected', 'true')
    await expect(box(page)).toHaveAttribute('aria-expanded', 'true')

    await page.keyboard.press('ArrowDown')
    await expect(options(page).nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(box(page)).toHaveAttribute('aria-activedescendant', /-1$/)
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp') // с первой по кругу на последнюю
    await expect(options(page).nth(3)).toHaveAttribute('aria-selected', 'true')
    await options(page).nth(2).hover()
    await expect(options(page).nth(2)).toHaveAttribute('aria-selected', 'true')
    await expect(box(page)).toBeFocused()
  })

  test('задача: открывается на доске её проекта, панель задачи на месте', async ({ page }) => {
    await openApp(page)
    const api2 = await projectByKey(page, 'API')
    await api(page, `/projects/${api2.id}/tasks`, { method: 'POST', data: { title: 'Задача мобильного для поиска' } })
    await openSearch(page)
    await type(page, 'мобильного для поиска')
    await expect(options(page)).toHaveCount(1)
    await page.keyboard.press('Enter')

    await expect(dialog(page)).toHaveCount(0)
    await expect(drawer(page)).toBeVisible()
    await expect(drawer(page).getByLabel('Название задачи')).toHaveValue('Задача мобильного для поиска')
    await expect(page.getByRole('heading', { name: 'Доска', level: 1 })).toBeVisible()
    await expect(page.locator('.side .cur', { hasText: 'Мобильный API' })).toBeVisible()
  })

  test('документ: открывается в экране «Документы» своего проекта', async ({ page }) => {
    await openApp(page)
    await openSearch(page)
    await type(page, 'планирование')
    await expect(options(page)).toHaveCount(1)
    await options(page).first().click()

    await expect(dialog(page)).toHaveCount(0)
    await expect(page.getByLabel('Название документа')).toHaveValue('Планирование Q4')
  })

  test('страница вики: открывается в вики', async ({ page }) => {
    await openApp(page)
    await openSearch(page)
    await type(page, 'соглашения по коду')
    await expect(options(page)).toHaveCount(1)
    await page.keyboard.press('Enter')

    await expect(page.getByLabel('Название страницы')).toHaveValue('Соглашения по коду')
  })

  test('файл: открывается библиотека файлов с его именем в поиске', async ({ page }) => {
    await openApp(page)
    await openSearch(page)
    await type(page, 'architecture')
    await expect(options(page)).toHaveCount(1)
    await expect(options(page).first()).toContainText('architecture-v2.pdf')
    await page.keyboard.press('Enter')

    await expect(page.getByRole('heading', { name: 'Файлы', exact: true })).toBeVisible()
    await expect(page.getByPlaceholder('Поиск файлов')).toHaveValue('architecture-v2.pdf')
    await expect(page.getByRole('button', { name: 'architecture-v2.pdf' })).toBeVisible()
  })

  test('Enter без результатов ничего не делает, окно остаётся', async ({ page }) => {
    await openApp(page)
    await openSearch(page)
    await type(page, 'яяяяя')
    await page.keyboard.press('Enter')
    await expect(dialog(page)).toBeVisible()
  })
})

// ===== Без связи =====

test('без связи окно открывается, а поиск честно говорит, что не вышло', async ({ page }) => {
  await openApp(page)
  await expect(card(page, 'WEB-141')).toBeVisible()
  await cutOffAndWait(page)
  await openSearch(page)
  await type(page, 'экспорт')
  await expect(dialog(page)).toContainText('Не удалось выполнить поиск', { timeout: 15_000 })
})

// ===== Внешний вид =====

for (const theme of ['light', 'dark'] as const) {
  test(`окно «Поиск» (${theme}) собрано из переменных темы`, async ({ page }) => {
    await openApp(page, { theme })
    await seedFindable(page)
    await openSearch(page)
    await type(page, 'поиск-тест')
    await expect(options(page)).toHaveCount(4)
    await page.keyboard.press('ArrowDown')
    await page.mouse.move(5, 5)
    await expect(page).toHaveScreenshot(`search-${theme}.png`)
  })
}
