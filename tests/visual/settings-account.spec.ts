import { expect, test, type Browser, type Page } from '@playwright/test'
import { openApp, resetData, SERVER } from './fixtures'
import { openSettings, USER_BUTTON } from './settings-helpers'

// Настройки → «Аккаунт»: профиль и смена пароля. Тесты меняют имя и пароль, поэтому данные возвращаются
// к данным макета и до каждого теста, и после последнего.

test.beforeEach(() => resetData())
test.afterAll(() => resetData())

const LIVE = { timeout: 2000 } // чужое изменение приходит за 1–2 секунды
const OLD = 'dev'
const NEW = 'новый-пароль-1'

const saveProfile = (dialog: ReturnType<Page['locator']>) => dialog.getByRole('button', { name: 'Сохранить', exact: true })

/** Ещё одно окно браузера со своим входом: другое устройство того же человека или другой человек */
async function openAs(browser: Browser, email: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU', timezoneId: 'UTC', reducedMotion: 'reduce' })
  const page = await context.newPage()
  await openApp(page, { email })
  return { page, close: () => context.close() }
}

/** Ещё одна сессия того же человека: только токены, без окна (как вход с другого компьютера) */
async function anotherSession(page: Page, email = 'lena@example.com', password = OLD): Promise<string> {
  const res = await page.request.post(`${SERVER}/api/v1/auth/login`, { data: { email, password } })
  expect(res.ok()).toBeTruthy()
  return ((await res.json()) as { refresh_token: string }).refresh_token
}

const refreshStatus = async (page: Page, refreshToken: string) =>
  (await page.request.post(`${SERVER}/api/v1/auth/refresh`, { data: { refresh_token: refreshToken } })).status()

// ===== Профиль =====

test.describe('профиль', () => {
  test('имя, роль и цвет меняются: видно в боковом меню и после перезапуска', async ({ page }) => {
    await openApp(page)
    const dialog = await openSettings(page)
    const save = saveProfile(dialog)
    await expect(save, 'пока ничего не менялось, сохранять нечего').toBeDisabled()

    await dialog.getByLabel('Имя').fill('Лена Кравцова')
    await dialog.getByLabel('Роль').fill('Lead')
    await dialog.getByRole('button', { name: 'Розовый' }).click()
    await expect(dialog.getByRole('button', { name: 'Розовый' })).toHaveAttribute('aria-pressed', 'true')
    await expect(save).toBeEnabled()
    await save.click()

    await expect(dialog.getByText('Сохранено')).toBeVisible()
    await expect(save, 'сохранено: снова нечего сохранять').toBeDisabled()
    await expect(page.getByRole('button', { name: /Лена Кравцова\s*Lead/ })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('button', { name: /Лена Кравцова\s*Lead/ })).toBeVisible()
  })

  test('пробелы по краям убираются, пустое имя сохранить нельзя', async ({ page }) => {
    await openApp(page)
    const dialog = await openSettings(page)
    const name = dialog.getByLabel('Имя')
    await name.fill('   ')
    await expect(saveProfile(dialog)).toBeDisabled()

    await name.fill('  Лена К.  ')
    await saveProfile(dialog).click()
    await expect(dialog.getByText('Сохранено')).toBeVisible()
    await expect(name).toHaveValue('Лена К.')
    await expect(page.getByRole('button', { name: /Лена К\.\s*Frontend/ })).toBeVisible()
  })

  test('подпись под именем можно очистить', async ({ page }) => {
    await openApp(page)
    const dialog = await openSettings(page)
    await dialog.getByLabel('Роль').fill('')
    await saveProfile(dialog).click()
    await expect(dialog.getByText('Сохранено')).toBeVisible()
    await page.reload()
    const card = page.locator('.app > .side').getByRole('button', { name: /Лена М\.$/ })
    await expect(card).toBeVisible()
    await expect(card, 'подписи под именем больше нет').not.toContainText('Frontend')
  })

  test('сервер отказал: понятное сообщение, окно не закрывается', async ({ page }) => {
    await openApp(page)
    const dialog = await openSettings(page)
    await page.route('**/api/v1/me', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'bad_request', message: 'Имя: от 1 до 60 символов' }) })
        : route.continue(),
    )
    await dialog.getByLabel('Имя').fill('Другое имя')
    await saveProfile(dialog).click()
    await expect(dialog.getByRole('alert')).toHaveText('Имя: от 1 до 60 символов')
    await expect(saveProfile(dialog), 'исправить и повторить можно').toBeEnabled()
    await expect(dialog.getByText('Сохранено')).toHaveCount(0)
  })

  test('другое устройство того же человека и другой человек видят новое имя за две секунды', async ({ page, browser }) => {
    await openApp(page)
    const device = await openAs(browser, 'lena@example.com')
    const artem = await openAs(browser, 'artem@example.com')
    try {
      await expect(device.page.getByRole('button', { name: USER_BUTTON })).toBeVisible()
      await artem.page.getByRole('button', { name: /^Фильтры/ }).click()
      await expect(artem.page.getByRole('dialog', { name: 'Фильтры' }).getByRole('button', { name: 'Лена М.', exact: true })).toBeVisible()

      const dialog = await openSettings(page)
      await dialog.getByLabel('Имя').fill('Лена Кравцова')
      await saveProfile(dialog).click()
      await expect(dialog.getByText('Сохранено')).toBeVisible()

      // то же устройство другого окна: имя в боковом меню (берётся из сессии) обновилось без перезагрузки
      await expect(device.page.getByRole('button', { name: /Лена Кравцова\s*Frontend/ })).toBeVisible(LIVE)
      // другой человек: в списке исполнителей фильтра
      await expect(artem.page.getByRole('dialog', { name: 'Фильтры' }).getByRole('button', { name: 'Лена Кравцова', exact: true })).toBeVisible(LIVE)
    } finally {
      await device.close()
      await artem.close()
    }
  })
})

// ===== Пароль =====

test.describe('смена пароля', () => {
  async function openForm(page: Page) {
    const dialog = await openSettings(page)
    await dialog.getByRole('button', { name: 'Сменить пароль' }).click()
    return dialog
  }
  const fill = async (dialog: ReturnType<Page['locator']>, current: string, next: string, again = next) => {
    await dialog.getByLabel('Текущий').fill(current)
    await dialog.getByLabel('Новый').fill(next)
    await dialog.getByLabel('Ещё раз').fill(again)
  }
  const submit = (dialog: ReturnType<Page['locator']>) => dialog.getByRole('button', { name: 'Сохранить пароль' })

  test('опечатки видны сразу, запрос на сервер не уходит', async ({ page }) => {
    await openApp(page)
    const sent: string[] = []
    page.on('request', (r) => r.url().endsWith('/auth/password') && sent.push(r.url()))
    const dialog = await openForm(page)

    await fill(dialog, OLD, NEW, 'другой-повтор-2')
    await submit(dialog).click()
    await expect(dialog.getByRole('alert')).toHaveText('Пароли не совпадают')

    await fill(dialog, OLD, 'коротко')
    await submit(dialog).click()
    await expect(dialog.getByRole('alert')).toHaveText('Новый пароль короче 8 символов')

    await fill(dialog, OLD, OLD.repeat(3))
    await fill(dialog, '', NEW)
    await submit(dialog).click()
    await expect(dialog.getByRole('alert')).toHaveText('Введите текущий пароль')
    expect(sent).toEqual([])
  })

  test('неверный текущий пароль: сообщение сервера, человек остаётся в приложении', async ({ page }) => {
    await openApp(page)
    const dialog = await openForm(page)
    await fill(dialog, 'не-мой-пароль', NEW)
    await submit(dialog).click()
    await expect(dialog.getByRole('alert')).toHaveText('Текущий пароль указан неверно')
    // это 400, а не 401: клиент не принимает его за потерянную сессию
    await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
    await expect(dialog).toBeVisible()
  })

  test('успех: человек остаётся в системе, пароль новый, остальные входы завершены', async ({ page }) => {
    await openApp(page)
    const other = await anotherSession(page)
    const dialog = await openForm(page)
    await fill(dialog, OLD, NEW)
    await submit(dialog).click()

    await expect(dialog.getByText('Пароль изменён. Входы на других устройствах завершены.')).toBeVisible()
    await expect(dialog.getByLabel('Текущий'), 'форма свернулась').toHaveCount(0)
    expect(await refreshStatus(page, other), 'другое устройство вышло').toBe(401)

    // здесь входить заново не нужно: и сейчас, и после перезапуска
    await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()

    // выход и вход: старый пароль не подходит, новый подходит
    await page.getByRole('button', { name: USER_BUTTON }).click()
    await page.getByRole('menuitem', { name: 'Выйти' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Вход')
    await page.getByLabel('Пароль').fill(OLD)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page.getByText('Неверный e-mail или пароль')).toBeVisible()
    await page.getByLabel('Пароль').fill(NEW)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
  })

  test('«Отмена» сворачивает форму и стирает введённое', async ({ page }) => {
    await openApp(page)
    const dialog = await openForm(page)
    await fill(dialog, OLD, NEW)
    await dialog.getByRole('button', { name: 'Отмена' }).click()
    await expect(dialog.getByLabel('Текущий')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Сменить пароль' }).click()
    await expect(dialog.getByLabel('Текущий')).toHaveValue('')
    await expect(dialog.getByLabel('Новый')).toHaveValue('')
  })
})
