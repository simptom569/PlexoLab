import { expect, test } from '@playwright/test'
import { openApp, openFresh, resetData, SERVER } from './fixtures'

// Путь пользователя от запуска до входа: адрес сервера, потом e-mail и пароль, дальше вход без вопросов.

const address = SERVER.replace('http://', '') // 127.0.0.1:8099, без схемы: клиент сам найдёт http

test.beforeEach(() => resetData())

test('первый запуск: шаг 1 — адрес сервера, шаг 2 — e-mail и пароль', async ({ page }) => {
  await openFresh(page)

  // шаг 1
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Адрес сервера')
  await expect(page.getByRole('button', { name: 'Продолжить' })).toBeDisabled()
  await page.getByLabel('Адрес сервера').fill(address)
  await page.getByRole('button', { name: 'Продолжить' }).click()

  // шаг 2: показан адрес, поля e-mail и пароль
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Вход')
  await expect(page.locator('.sub .mono')).toHaveText(address)
  await page.getByLabel('E-mail').fill('lena@example.com')
  await page.getByLabel('Пароль').fill('dev')
  await page.getByRole('button', { name: 'Войти' }).click()

  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Лена М\.\s*Frontend/ })).toBeVisible()
})

test('адрес можно ввести с http:// и со слэшем на конце', async ({ page }) => {
  await openFresh(page)
  await page.getByLabel('Адрес сервера').fill(`  ${SERVER}/  `)
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Вход')
  await expect(page.locator('.sub .mono')).toHaveText(address)
})

test('адрес, по которому нет сервера, и чужой сервер дают понятную ошибку', async ({ page }) => {
  await openFresh(page)
  const input = page.getByLabel('Адрес сервера')

  await input.fill('127.0.0.1:1')
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.getByRole('alert')).toContainText('Не удалось подключиться по этому адресу')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Адрес сервера')

  // по этому адресу отвечает Vite, а не сервер PlexoLab
  await input.fill('http://localhost:1420')
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.getByRole('alert')).toContainText('отвечает не сервер PlexoLab')

  await input.fill('ftp://x')
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.getByRole('alert')).toContainText('http:// или https://')
})

test('неверный пароль: ошибка, пароль очищен, e-mail остался', async ({ page }) => {
  await openFresh(page)
  await page.getByLabel('Адрес сервера').fill(address)
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await page.getByLabel('E-mail').fill('lena@example.com')
  await page.getByLabel('Пароль').fill('не тот')
  await page.getByRole('button', { name: 'Войти' }).click()

  await expect(page.getByRole('alert')).toHaveText('Неверный e-mail или пароль')
  await expect(page.getByLabel('Пароль')).toHaveValue('')
  await expect(page.getByLabel('E-mail')).toHaveValue('lena@example.com')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Вход')
})

test('Enter отправляет форму, e-mail без учёта регистра', async ({ page }) => {
  await openFresh(page)
  await page.getByLabel('Адрес сервера').fill(address)
  await page.keyboard.press('Enter')
  await page.getByLabel('E-mail').fill('LENA@example.com')
  await page.getByLabel('Пароль').fill('dev')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
})

test('«Сменить сервер» возвращает на шаг 1 с прежним адресом', async ({ page }) => {
  await openFresh(page)
  await page.getByLabel('Адрес сервера').fill(address)
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await page.getByRole('button', { name: 'Сменить сервер' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Адрес сервера')
  await expect(page.getByLabel('Адрес сервера')).toHaveValue(address)
})

test('следующие запуски: без вопросов, сразу в приложение', async ({ page }) => {
  await openFresh(page)
  await page.getByLabel('Адрес сервера').fill(address)
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await page.getByLabel('E-mail').fill('lena@example.com')
  await page.getByLabel('Пароль').fill('dev')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()

  // и так несколько раз подряд: refresh-токен одноразовый, клиент каждый раз получает новый
  for (let i = 0; i < 3; i++) {
    await page.reload()
    await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Вход|Адрес сервера/ })).toHaveCount(0)
  }
})

test('выход, затем вход: e-mail подставлен, нужен только пароль', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: /Лена М\./ }).click()
  await page.getByRole('menuitem', { name: 'Выйти' }).click()
  await expect(page.getByLabel('E-mail')).toHaveValue('lena@example.com')
  await page.getByLabel('Пароль').fill('dev')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()

  // после выхода старый вход не восстанавливается
  await page.getByRole('button', { name: /Лена М\./ }).click()
  await page.getByRole('menuitem', { name: 'Выйти' }).click()
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Вход')
})

test('сервер недоступен при запуске: «Нет связи», вход не теряется, «Повторить» работает', async ({ page }) => {
  await openApp(page)
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
  await page.waitForTimeout(300)

  // сервер «пропадает»: все запросы к нему падают
  await page.route(`${SERVER}/**`, (route) => route.abort('connectionrefused'))
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Нет связи с сервером')
  await expect(page.getByRole('alert')).toHaveCount(0)

  // сервер вернулся
  await page.unroute(`${SERVER}/**`)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
})

test('сохранённый вход отозван (пароль сменили или учётную запись удалили): клиент возвращается к входу', async ({ page }) => {
  await openApp(page)
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
  await page.waitForTimeout(300)

  // сервер отвечает «токен недействителен»: подменяем сохранённый токен на неизвестный
  await page.evaluate(() => {
    for (const key of Object.keys(window.localStorage)) if (key.startsWith('plexolab.refresh@')) window.localStorage.setItem(key, 'отозван')
  })
  await page.reload()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Вход')
  await expect(page.getByLabel('E-mail')).toHaveValue('lena@example.com')
  await expect(page.getByRole('alert')).toHaveCount(0)
})