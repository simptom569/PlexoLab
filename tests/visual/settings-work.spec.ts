import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { openApp, SERVER } from './fixtures'
import { openSettings, pickTab, USER_BUTTON } from './settings-helpers'

// Настройки из окна «Настройки» действуют: тема, полосы прокрутки, первый день недели, сбросы, связь, выход, версия.
// Как окно выглядит и листается, проверяет settings.spec.ts.

const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('plexolab.settings') ?? '{}') as Record<string, unknown>)
const dark = /\bdark\b/
const tauriVersion = (JSON.parse(readFileSync(new URL('../../app/src-tauri/tauri.conf.json', import.meta.url), 'utf8')) as { version: string }).version
const HIGH_ONLY = { who: [], prio: ['high'], tag: [], module: [], due: 'any' }

test.describe('тема', () => {
  test('«как в системе» следует системе и меняется на лету', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await openApp(page, { theme: 'system' })
    await expect(page.locator('.app')).toHaveClass(dark)
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('.app')).not.toHaveClass(dark)
  })

  test('выбор «Как в системе» запоминается', async ({ page }) => {
    await openApp(page)
    const dialog = await openSettings(page)
    await pickTab(dialog, 'Внешний вид')
    await dialog.getByRole('group', { name: 'Тема' }).getByRole('button', { name: 'Как в системе' }).click()
    await expect.poll(async () => (await stored(page)).theme).toBe('system')
  })

  test('быстрый переключатель в меню при «как в системе» идёт от видимой темы', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await openApp(page, { theme: 'system' })
    await page.getByRole('button', { name: USER_BUTTON }).click()
    await page.getByRole('menuitem', { name: 'Светлая тема' }).click()
    await expect(page.locator('.app')).not.toHaveClass(dark)
    await expect.poll(async () => (await stored(page)).theme).toBe('light')
  })
})

test('полосы прокрутки: режим применяется, запоминается и переживает перезапуск', async ({ page }) => {
  await openApp(page)
  await expect(page.locator('html')).toHaveAttribute('data-scrollbars', 'visible')
  const dialog = await openSettings(page)
  await pickTab(dialog, 'Внешний вид')
  const group = dialog.getByRole('group', { name: 'Полосы прокрутки' })
  await group.getByRole('button', { name: 'Тихие' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-scrollbars', 'quiet')
  await group.getByRole('button', { name: 'Скрытые' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-scrollbars', 'hidden')
  await expect.poll(async () => (await stored(page)).scrollbars).toBe('hidden')

  await page.reload()
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-scrollbars', 'hidden')
})

test.describe('первый день недели', () => {
  test('календарь переключается на воскресенье', async ({ page }) => {
    await openApp(page, { settings: { view: 'cal' } })
    const heads = page.locator('.cal-wd')
    await expect(heads).toHaveText(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'])
    await expect(page.locator('.cal-cell').first()).toHaveAttribute('data-day', '2026-09-28')

    const dialog = await openSettings(page)
    await pickTab(dialog, 'Доска')
    await dialog.getByRole('group', { name: 'Первый день недели' }).getByRole('button', { name: 'Воскресенье' }).click()
    await page.keyboard.press('Escape')

    await expect(heads).toHaveText(['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'])
    await expect(page.locator('.cal-cell').first()).toHaveAttribute('data-day', '2026-09-27')
    await expect.poll(async () => (await stored(page)).weekStart).toBe('sun')
  })

  test('диаграмма Ганта начинается с воскресенья', async ({ page }) => {
    await openApp(page, { settings: { view: 'gantt' } })
    // «сегодня» в тестах воскресенье 18 октября: с понедельника окно начинается 12-го
    await expect(page.locator('.cal-head strong')).toHaveText('12 окт – 22 ноя')
    const dialog = await openSettings(page)
    await pickTab(dialog, 'Доска')
    await dialog.getByRole('group', { name: 'Первый день недели' }).getByRole('button', { name: 'Воскресенье' }).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('.cal-head strong')).toHaveText('18 окт – 28 ноя')
  })
})

test.describe('сбросы', () => {
  test('«Сбросить фильтры и вид» не трогает тему', async ({ page }) => {
    await openApp(page, { theme: 'dark', settings: { view: 'list', filters: HIGH_ONLY } })
    const views = page.getByRole('group', { name: 'Вид задач' })
    await expect(views.getByRole('button', { name: 'Список' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: /^Фильтры/ }).locator('.badge')).toHaveText('1')

    const dialog = await openSettings(page)
    await pickTab(dialog, 'Данные')
    await dialog.getByRole('button', { name: 'Сбросить', exact: true }).click()
    await dialog.getByRole('button', { name: 'Точно сбросить?' }).click()
    await expect(dialog.getByRole('status')).toHaveText('Готово')
    await page.keyboard.press('Escape')

    await expect(views.getByRole('button', { name: 'Доска' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: /^Фильтры/ }).locator('.badge')).toHaveCount(0)
    await expect(page.locator('.app')).toHaveClass(dark)
  })

  test('«Сбросить всё» возвращает тему, вид и фильтры, а адрес сервера и вход остаются', async ({ page }) => {
    await openApp(page, { theme: 'dark', settings: { view: 'list', scrollbars: 'hidden', filters: HIGH_ONLY } })
    const dialog = await openSettings(page)
    await pickTab(dialog, 'Данные')
    await dialog.getByRole('button', { name: 'Сбросить всё' }).click()
    await dialog.getByRole('button', { name: 'Точно сбросить?' }).click()
    await expect(dialog.getByRole('status')).toHaveText('Готово')

    await expect(page.locator('.app')).not.toHaveClass(dark)
    await expect(page.locator('html')).toHaveAttribute('data-scrollbars', 'visible')
    await expect.poll(async () => (await stored(page)).theme).toBe('light')
    const saved = await stored(page)
    expect(saved).toMatchObject({ view: 'board', scrollbars: 'visible', weekStart: 'mon', live: true, serverUrl: SERVER })
    await expect(dialog).toBeVisible() // окно осталось открытым
  })
})

test.describe('связь с сервером', () => {
  test('«Проверить связь» показывает, за сколько ответил сервер', async ({ page }) => {
    await openApp(page)
    const dialog = await openSettings(page)
    await pickTab(dialog, 'Связь с сервером')
    await expect(dialog.getByText(SERVER)).toBeVisible()
    await dialog.getByRole('button', { name: 'Проверить связь' }).click()
    await expect(dialog.getByRole('status')).toHaveText(/^Сервер ответил за \d+ мс$/)
  })

  test('«Проверить связь», когда сервер не отвечает, пишет об этом', async ({ page }) => {
    await openApp(page)
    const dialog = await openSettings(page)
    await pickTab(dialog, 'Связь с сервером')
    await page.route('**/healthz', (route) => route.abort())
    await dialog.getByRole('button', { name: 'Проверить связь' }).click()
    await expect(dialog.getByRole('status')).toHaveText('Нет связи с сервером')
  })

  test('«Обновлять вживую»: выключено — соединения нет, включили — появилось', async ({ page }) => {
    const sockets: string[] = []
    page.on('websocket', (ws) => ws.url().includes('/api/v1/ws') && sockets.push(ws.url()))
    await openApp(page, { settings: { live: false } })
    await page.waitForTimeout(1500) // отсутствие соединения за это время и есть проверка
    expect(sockets).toEqual([])
    await expect(page.locator('[data-connection]')).toHaveCount(0)

    const dialog = await openSettings(page)
    await pickTab(dialog, 'Связь с сервером')
    await expect(dialog.getByText('Обновление вживую выключено')).toBeVisible()
    const live = dialog.getByRole('switch', { name: 'Обновлять вживую' })
    await expect(live).toHaveAttribute('aria-checked', 'false')
    await live.click()
    await expect(live).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('[data-connection]')).toHaveAttribute('data-connection', 'open')
    expect(sockets).toHaveLength(1)
    await expect.poll(async () => (await stored(page)).live).toBe(true)
  })

  test('«Показывать, где правят другие»: включено по умолчанию, выключается и запоминается, без живых обновлений недоступно', async ({ page }) => {
    await openApp(page)
    const dialog = await openSettings(page)
    await pickTab(dialog, 'Связь с сервером')
    const presence = dialog.getByRole('switch', { name: 'Показывать, где правят другие' })
    await expect(presence).toHaveAttribute('aria-checked', 'true')
    await expect(presence).toBeEnabled()
    await presence.click()
    await expect(presence).toHaveAttribute('aria-checked', 'false')
    await expect.poll(async () => (await stored(page)).presence).toBe(false)
    // без живых обновлений метки невозможны, поэтому тумблер недоступен
    await dialog.getByRole('switch', { name: 'Обновлять вживую' }).click()
    await expect(presence).toBeDisabled()
  })

  test('«Сменить сервер» открывает шаг с адресом и закрывает окно', async ({ page }) => {
    await openApp(page)
    const dialog = await openSettings(page)
    await pickTab(dialog, 'Связь с сервером')
    await dialog.getByRole('button', { name: 'Сменить сервер' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Адрес сервера')
    await expect(page.getByRole('dialog', { name: 'Настройки' })).toHaveCount(0)
  })
})

test('«Выйти» в аккаунте выходит, а после нового входа окно настроек не открывается само', async ({ page }) => {
  await openApp(page)
  const dialog = await openSettings(page)
  await dialog.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Вход')

  await page.getByLabel('Пароль').fill('dev')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Настройки' })).toHaveCount(0)
})

test('«О программе» показывает версию из tauri.conf.json', async ({ page }) => {
  await openApp(page)
  const dialog = await openSettings(page)
  await pickTab(dialog, 'О программе')
  await expect(dialog.getByText(tauriVersion, { exact: true })).toBeVisible()
})
