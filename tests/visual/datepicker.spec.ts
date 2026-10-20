import { expect, test, type Locator, type Page } from '@playwright/test'
import { openApp, resetData, SERVER } from './fixtures'
import { switchToDark } from './helpers'

test.beforeEach(() => resetData())

const picker = (page: Page) => page.getByRole('dialog', { name: 'Выбор даты' })
const drawer = (page: Page) => page.getByRole('dialog', { name: /^Задача / })
/** Строка вехи по названию: после смены даты строки пересортировываются, поэтому `.last()` ненадёжен */
const row = (page: Page, title: string) => page.locator('.ms-row').filter({ has: page.locator(`input[aria-label="Название вехи"][value="${title}"]`) })
/** Кнопка-иконка рядом с полем (поле и кнопка лежат в одной обёртке) */
const opener = (field: Locator) => field.locator('xpath=..').getByRole('button', { name: 'Открыть календарь' })

async function api<T>(page: Page, path: string): Promise<T> {
  const login = await page.request.post(`${SERVER}/api/v1/auth/login`, { data: { email: 'lena@example.com', password: 'dev' } })
  const { access_token } = (await login.json()) as { access_token: string }
  return (await (await page.request.get(`${SERVER}/api/v1${path}`, { headers: { Authorization: `Bearer ${access_token}` } })).json()) as T
}

async function projectId(page: Page) {
  const projects = await api<Array<{ id: string; name: string }>>(page, '/projects')
  return projects.find((p) => p.name === 'Web-приложение')!.id
}

const milestones = async (page: Page) =>
  (await api<{ milestones: Array<{ title: string; due_date: string }> }>(page, `/projects/${await projectId(page)}/board`)).milestones

const task = async (page: Page, key: string) =>
  (await api<{ tasks: Array<{ key: string; due_date: string | null }> }>(page, `/projects/${await projectId(page)}/board`)).tasks.find((t) => t.key === key)!

/** Окно целиком в видимой части приложения, а не обрезано областью с overflow:hidden */
async function expectInsideViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox()
  const size = page.viewportSize()!
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(size.width)
  expect(box!.y + box!.height).toBeLessThanOrEqual(size.height)
}

test.describe('календарик в поле даты', () => {
  test('открывается своё окно внутри области с overflow:hidden', async ({ page }) => {
    await openApp(page, { settings: { page: 'releases' } })
    const field = row(page, 'Релиз 2.9.0').getByLabel('Дата вехи')
    await expect(field).toHaveValue('2026-11-20')

    await opener(field).click()
    await expect(picker(page)).toBeVisible()
    await expect(opener(field)).toHaveAttribute('aria-expanded', 'true')
    await expect(picker(page).locator('strong')).toHaveText('Ноябрь 2026')
    await expect(picker(page).getByRole('button', { name: '20 ноября 2026' })).toHaveClass(/\bon\b/)
    await expect(picker(page).getByRole('gridcell', { name: '20 ноября 2026' })).toHaveAttribute('aria-selected', 'true')
    await expectInsideViewport(page, picker(page))
    // 42 дня и подписи дней недели с понедельника
    await expect(picker(page).getByRole('gridcell')).toHaveCount(42)
    await expect(picker(page).getByRole('columnheader')).toHaveText(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'])
  })

  test('выбор дня мышью меняет дату и закрывает окно; месяцы листаются', async ({ page }) => {
    await openApp(page, { settings: { page: 'releases' } })
    const field = row(page, 'Релиз 2.9.0').getByLabel('Дата вехи')
    await opener(field).click()
    await picker(page).getByRole('button', { name: 'Месяц вперёд' }).click()
    await expect(picker(page).locator('strong')).toHaveText('Декабрь 2026')
    await picker(page).getByRole('button', { name: 'Месяц назад' }).click()
    await picker(page).getByRole('button', { name: 'Месяц назад' }).click()
    await expect(picker(page).locator('strong')).toHaveText('Октябрь 2026')
    // сегодня (18 октября) помечено
    await expect(picker(page).getByRole('button', { name: '18 октября 2026' })).toHaveAttribute('aria-current', 'date')
    await picker(page).getByRole('button', { name: '28 октября 2026' }).click()
    await expect(picker(page)).toHaveCount(0)
    await expect(field).toHaveValue('2026-10-28')
    await expect.poll(async () => (await milestones(page)).map((m) => m.due_date)).toContain('2026-10-28')
    await expect(opener(field)).toBeFocused()
  })

  test('клавиатура: Alt+↓ открывает, стрелки и PageDown двигают день, Enter выбирает, Esc закрывает', async ({ page }) => {
    await openApp(page, { settings: { page: 'releases' } })
    const field = row(page, 'Релиз 2.9.0').getByLabel('Дата вехи')
    await field.focus()
    await field.press('Alt+ArrowDown')
    await expect(picker(page)).toBeVisible()
    // фокус сразу на выбранном дне
    await expect(picker(page).getByRole('button', { name: '20 ноября 2026' })).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(picker(page).getByRole('button', { name: '21 ноября 2026' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(picker(page).getByRole('button', { name: '28 ноября 2026' })).toBeFocused()
    await page.keyboard.press('PageDown')
    await expect(picker(page).locator('strong')).toHaveText('Декабрь 2026')
    await expect(picker(page).getByRole('button', { name: '28 декабря 2026' })).toBeFocused()
    await page.keyboard.press('Home')
    await expect(picker(page).getByRole('button', { name: '28 декабря 2026' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(picker(page)).toHaveCount(0)
    await expect(field).toHaveValue('2026-12-28')
    await expect(opener(field)).toBeFocused()

    // Esc закрывает окно, дата не меняется
    await opener(field).click()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Escape')
    await expect(picker(page)).toHaveCount(0)
    await expect(field).toHaveValue('2026-12-28')
    await expect(opener(field)).toBeFocused()
  })

  test('Tab не выходит из окна; клик мимо закрывает', async ({ page }) => {
    await openApp(page, { settings: { page: 'releases' } })
    const field = row(page, 'Релиз 2.9.0').getByLabel('Дата вехи')
    await opener(field).click()
    const inside = async () => picker(page).evaluate((el) => el.contains(document.activeElement))
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab')
      expect(await inside()).toBe(true)
    }
    await page.mouse.click(700, 60)
    await expect(picker(page)).toHaveCount(0)
    await expect(field).toHaveValue('2026-11-20')
  })

  test('ввод с клавиатуры по частям даты остаётся родным', async ({ page }) => {
    await openApp(page, { settings: { page: 'releases' } })
    const field = row(page, 'Релиз 2.9.0').getByLabel('Дата вехи')
    await field.fill('2026-11-25')
    await expect.poll(async () => (await milestones(page)).map((m) => m.due_date)).toContain('2026-11-25')
  })

  test('в панели задачи: окно поверх панели, «Сегодня» и «Очистить»; Esc не закрывает панель', async ({ page }) => {
    await openApp(page)
    await page.locator('[data-card-id]', { hasText: 'WEB-144' }).click()
    const d = drawer(page)
    const field = d.getByLabel('Срок')
    await expect(field).toHaveValue('2026-10-23')
    await opener(field).click()
    await expect(picker(page)).toBeVisible()
    await expectInsideViewport(page, picker(page))
    await page.keyboard.press('Escape')
    await expect(picker(page)).toHaveCount(0)
    await expect(d).toBeVisible()

    await opener(field).click()
    await picker(page).getByRole('button', { name: 'Сегодня' }).click()
    await expect(field).toHaveValue('2026-10-18')
    await expect.poll(async () => (await task(page, 'WEB-144')).due_date).toBe('2026-10-18')

    await opener(field).click()
    await picker(page).getByRole('button', { name: 'Очистить' }).click()
    await expect(field).toHaveValue('')
    await expect.poll(async () => (await task(page, 'WEB-144')).due_date).toBeNull()

    // без даты «Очистить» не нужна
    await opener(field).click()
    await expect(picker(page).locator('strong')).toHaveText('Октябрь 2026')
    await expect(picker(page).getByRole('button', { name: 'Очистить' })).toHaveCount(0)
  })

  test('у даты вехи кнопки «Очистить» нет: дата обязательна', async ({ page }) => {
    await openApp(page, { settings: { page: 'releases' } })
    await opener(row(page, 'Релиз 2.9.0').getByLabel('Дата вехи')).click()
    await expect(picker(page).getByRole('button', { name: 'Сегодня' })).toBeVisible()
    await expect(picker(page).getByRole('button', { name: 'Очистить' })).toHaveCount(0)
  })

  test('в тёмной теме окно берёт цвета темы', async ({ page }) => {
    await openApp(page, { settings: { page: 'releases' } })
    await switchToDark(page)
    const field = row(page, 'Релиз 2.9.0').getByLabel('Дата вехи')
    await opener(field).click()
    const colors = await picker(page).evaluate((el) => {
      const root = getComputedStyle(el.closest('.app')!)
      const style = getComputedStyle(el)
      return { bg: style.backgroundColor, surface: root.getPropertyValue('--surface').trim() }
    })
    // фон окна — --surface тёмной темы (#161921)
    expect(colors.surface.toLowerCase()).toBe('#161921')
    expect(colors.bg).toBe('rgb(22, 25, 33)')
  })
})
