// Лента активности: сверка с эталоном (экран 18) и поведение: группы по дням, фильтры, дозагрузка по 50, ошибка загрузки.

import { expect, test, type Page } from '@playwright/test'
import { compareToReference, type Rect } from './compare'
import { openApp, resetData, SERVER } from './fixtures'
import { textRects } from './helpers'
import { MAX_DIFF_RATIO } from './tolerance'
import { api, token } from './wiki-helpers'

// Всё правее бокового меню: меню сверяется отдельно (sidebar.spec.ts)
const MAIN: Rect = { x: 233, y: 0, width: 1207, height: 900 }

// запросы ленты к серверу; адрес вида /src/features/activity/… (модули приложения) сюда не относится
const ACTIVITY_API = /\/api\/v1\/projects\/[0-9a-f-]+\/activity/

test.beforeEach(() => resetData())

async function openActivity(page: Page, theme: 'light' | 'dark' = 'light', settings: Record<string, unknown> = {}) {
  await openApp(page, { theme, settings: { page: 'activity', ...settings } })
  await expect(page.getByRole('heading', { name: 'Активность', level: 1 })).toBeVisible()
  await expect(page.locator('.act-row').first()).toBeVisible()
}

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name })
const rows = (page: Page) => page.locator('.act-row')
const headings = (page: Page) => page.locator('main section .pop-title')
const who = (page: Page, name: string | RegExp) => page.getByRole('group', { name: 'Участник' }).getByRole('button', { name, exact: typeof name === 'string' })
const kind = (page: Page, name: string) => page.getByRole('group', { name: 'Тип события' }).getByRole('button', { name, exact: true })

/** Текст строки: «WEB-128 … перемещена в «Готово»» и под ним «Соня В. · 1 час назад» */
const rowTexts = (page: Page) => rows(page).evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))

async function compare(page: Page, file: string, name: string) {
  const actual = await page.screenshot({ clip: MAIN })
  const text = await textRects(page, MAIN)
  const { diffPixels, total, diffRatio } = compareToReference({ actual, referenceFile: file, region: MAIN, ignore: text, name })
  console.log(`  ${name}: отличается ${diffPixels} из ${total} (${(diffRatio * 100).toFixed(3)}%), строк текста исключено: ${text.length}`)
  expect(diffRatio).toBeLessThan(MAX_DIFF_RATIO)
}

// ===== Экран 18 =====

for (const theme of ['light', 'dark'] as const) {
  test(`18 активность (${theme === 'light' ? 'светлая' : 'тёмная'} тема)`, async ({ page }) => {
    await openActivity(page, theme)
    await expect(rows(page)).toHaveCount(8)
    await page.mouse.move(800, 880)
    await compare(page, `18-activity-${theme}.png`, `18-activity-${theme}`)
  })
}

// ===== Что показывает лента =====

test('события собраны по дням, у каждого участник, время и метка типа', async ({ page }) => {
  await openActivity(page)
  await expect(headings(page)).toHaveText(['Сегодня', 'Вчера', '15 октября'])
  expect(await rowTexts(page)).toEqual([
    'Д WEB-137 Неверные часовые пояса в календаре добавлен PR #315 Даниил С. · 12 минут назад Код',
    'С WEB-128 Ошибка 500 при пустом профиле перемещена в «Готово» Соня В. · 1 час назад Задача',
    'Л WEB-141 Тёмная тема для страницы настроек перемещена в «На ревью» Лена М. · 3 часа назад Задача',
    'И WEB-137 Неверные часовые пояса в календаре новый комментарий Игорь П. · вчера, 18:20 Комментарий',
    'А Страница «Архитектура» обновлена Артём К. · вчера, 15:02 Документ',
    'Д Релиз 2.8.0 отмечен шаг «Проверить миграции БД» Даниил С. · вчера, 12:10 Релиз',
    'С WEB-146 Не загружается аватар в Safari создана Соня В. · 15 окт, 11:40 Задача',
    'А WEB-144 Вход через SSO добавлен PR #321 Артём К. · 15 окт, 10:05 Код',
  ])
  await expect(rows(page).first().getByRole('img', { name: 'Даниил С.' })).toHaveText('Д')
  // группы: 3 + 3 + 2
  await expect(page.locator('main section').nth(0).locator('.act-row')).toHaveCount(3)
  await expect(page.locator('main section').nth(1).locator('.act-row')).toHaveCount(3)
  await expect(page.locator('main section').nth(2).locator('.act-row')).toHaveCount(2)
})

test('в фильтре участников все пятеро и «Все», типов восемь', async ({ page }) => {
  await openActivity(page)
  await expect(page.getByRole('group', { name: 'Участник' }).getByRole('button')).toHaveText(['Все', 'Лена М.', 'Артём К.', 'Даниил С.', 'Соня В.', 'Игорь П.'])
  await expect(page.getByRole('group', { name: 'Тип события' }).getByRole('button')).toHaveText([
    'Все события',
    'Задачи',
    'Комментарии',
    'Код',
    'Документы',
    'Релизы',
    'Файлы',
    'Модули',
  ])
  await expect(who(page, 'Все')).toHaveAttribute('aria-pressed', 'true')
  await expect(kind(page, 'Все события')).toHaveAttribute('aria-pressed', 'true')
})

test('чужие и свои действия на других экранах попадают в ленту: новый модуль первым, с меткой «Модуль»', async ({ page }) => {
  const projects = await api<Array<{ id: string; key: string }>>(page, '/projects')
  const web = projects.find((p) => p.key === 'WEB')!
  await api(page, `/projects/${web.id}/modules`, { method: 'POST', data: { title: 'Платежи' } })
  await openActivity(page)
  const first = rows(page).first()
  await expect(first).toContainText('Модуль «Платежи» создан')
  await expect(first).toContainText('Лена М.')
  await expect(first.locator('.tag')).toHaveText('Модуль')
  await expect(rows(page)).toHaveCount(9)
})

test('вернувшись на страницу, человек сразу видит то, что сделал на другом экране', async ({ page }) => {
  await openActivity(page)
  await expect(rows(page)).toHaveCount(8)
  await nav(page, 'Ссылки команды').click()
  await expect(page.getByRole('heading', { name: 'Ссылки команды', level: 1 })).toBeVisible()
  const projects = await api<Array<{ id: string; key: string }>>(page, '/projects')
  await api(page, `/projects/${projects.find((p) => p.key === 'WEB')!.id}/modules`, { method: 'POST', data: { title: 'Поиск' } })
  await nav(page, 'Активность').click()
  await expect(rows(page)).toHaveCount(9)
  await expect(rows(page).first()).toContainText('Модуль «Поиск» создан')
})

// ===== Фильтры =====

test('фильтр по участнику оставляет его события и убирает пустые дни', async ({ page }) => {
  await openActivity(page)
  await who(page, 'Соня В.').click()
  await expect(who(page, 'Соня В.')).toHaveAttribute('aria-pressed', 'true')
  await expect(who(page, 'Все')).toHaveAttribute('aria-pressed', 'false')
  await expect(rows(page)).toHaveCount(2)
  await expect(headings(page)).toHaveText(['Сегодня', '15 октября'])
  expect((await rowTexts(page)).map((t) => t.split(' ')[0])).toEqual(['С', 'С'])

  await who(page, 'Все').click()
  await expect(rows(page)).toHaveCount(8)
})

test('фильтр по типу: задачи, комментарии, код', async ({ page }) => {
  await openActivity(page)
  await kind(page, 'Задачи').click()
  await expect(rows(page)).toHaveCount(3)
  await expect(rows(page).locator('.tag')).toHaveText(['Задача', 'Задача', 'Задача'])
  await kind(page, 'Комментарии').click()
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toContainText('WEB-137 Неверные часовые пояса в календаре новый комментарий')
  await kind(page, 'Код').click()
  await expect(rows(page)).toHaveCount(2)
  await expect(headings(page)).toHaveText(['Сегодня', '15 октября'])
})

test('участник и тип работают вместе; когда ничего нет — «Под такие фильтры событий нет»', async ({ page }) => {
  await openActivity(page)
  await who(page, 'Даниил С.').click()
  await kind(page, 'Релизы').click()
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toContainText('Релиз 2.8.0')

  await kind(page, 'Файлы').click()
  await expect(rows(page)).toHaveCount(0)
  await expect(page.getByText('Под такие фильтры событий нет')).toBeVisible()
  await expect(headings(page)).toHaveCount(0)

  await kind(page, 'Все события').click()
  await expect(rows(page)).toHaveCount(2)
  await expect(page.getByText('Под такие фильтры событий нет')).toHaveCount(0)
})

test('фильтры помнятся после перезапуска приложения', async ({ page }) => {
  await openActivity(page)
  await who(page, 'Артём К.').click()
  await kind(page, 'Документы').click()
  await expect(rows(page)).toHaveCount(1)

  await page.reload()
  await expect(who(page, 'Артём К.')).toHaveAttribute('aria-pressed', 'true')
  await expect(kind(page, 'Документы')).toHaveAttribute('aria-pressed', 'true')
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toContainText('Страница «Архитектура» обновлена')
})

test('если сохранённого участника уже нет в команде, показываются все', async ({ page }) => {
  await openActivity(page, 'light', { actWho: '00000000-0000-0000-0000-000000000000' })
  await expect(rows(page)).toHaveCount(8)
  await expect(who(page, 'Все')).toHaveAttribute('aria-pressed', 'true')
})

// ===== Страницы по 50 =====

test('сначала приходит 50 событий, остальные подгружаются при прокрутке до конца', async ({ page }) => {
  // 60 новых комментариев: вместе с событиями макета 68, то есть две страницы
  const projects = await api<Array<{ id: string; key: string }>>(page, '/projects')
  const board = await api<{ tasks: Array<{ id: string }> }>(page, `/projects/${projects.find((p) => p.key === 'WEB')!.id}/board`)
  const bearer = { Authorization: `Bearer ${await token(page)}` }
  for (let i = 1; i <= 60; i++) {
    const res = await page.request.post(`${SERVER}/api/v1/tasks/${board.tasks[0]!.id}/comments`, { data: { body: `Комментарий ${i}` }, headers: bearer })
    expect(res.ok()).toBeTruthy()
  }

  const requests: string[] = []
  page.on('request', (r) => {
    if (ACTIVITY_API.test(r.url())) requests.push(new URL(r.url()).search)
  })
  await openActivity(page)

  await expect(rows(page)).toHaveCount(50)
  expect(requests, 'на экран ушёл один запрос, без курсора').toEqual([''])

  await rows(page).last().scrollIntoViewIfNeeded()
  await expect(rows(page)).toHaveCount(68)
  expect(requests).toHaveLength(2)
  expect(requests[1]).toMatch(/^\?before=\d+_[0-9a-f-]{36}$/)
  await expect(rows(page).last()).toContainText('WEB-144 Вход через SSO добавлен PR #321')

  // больше событий нет: дальше запросов не будет
  await rows(page).last().scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  expect(requests).toHaveLength(2)
  await expect(rows(page)).toHaveCount(68)
})

test('фильтр сбрасывает постраничную загрузку: запрос идёт с фильтром, а не со старым курсором', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (r) => {
    if (ACTIVITY_API.test(r.url())) requests.push(new URL(r.url()).search)
  })
  await openActivity(page)
  await kind(page, 'Код').click()
  await expect(rows(page)).toHaveCount(2)
  expect(requests).toEqual(['', '?kind=code'])
  await who(page, 'Артём К.').click()
  await expect(rows(page)).toHaveCount(1)
  expect(requests.at(-1)).toMatch(/^\?actor=[0-9a-f-]{36}&kind=code$/)
})

// ===== Ошибка загрузки =====

test('если сервер отказал, лента пишет об этом и «Повторить» загружает её', async ({ page }) => {
  let fail = true
  await page.route('**/api/v1/projects/*/activity**', (route) =>
    fail ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'bad_request', message: 'нет' }) }) : route.continue(),
  )
  await openApp(page, { settings: { page: 'activity' } })
  await expect(page.getByText('Не удалось загрузить ленту')).toBeVisible()
  await expect(rows(page)).toHaveCount(0)

  fail = false
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(rows(page)).toHaveCount(8)
  await expect(page.getByText('Не удалось загрузить ленту')).toHaveCount(0)
})
