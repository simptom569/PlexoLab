import { expect, test, type Page } from '@playwright/test'
import { openFresh, resetData, SERVER } from './fixtures'
import { address, codeOf, openLogin, readOutbox, waitForMail } from './signup-helpers'

// Регистрация и «Забыли пароль?» (docs/REGISTRATION.md): письмо с кодом, два шага, ошибки кода, сброс пароля.
// Тестовый сервер не отправляет письма, а пишет их в папку (MAIL_OUTBOX_DIR), оттуда тесты берут код.

const NEWBIE = 'newbie@example.com'
const heading = (page: Page) => page.getByRole('heading', { level: 1 })
const app = (page: Page) => page.getByRole('navigation', { name: 'Основная навигация' })

test.beforeEach(() => resetData())

/** Со входа на «Создать аккаунт», e-mail введён, письмо отправлено, открыт шаг «Введите код» */
async function askRegisterCode(page: Page, email = NEWBIE) {
  await openLogin(page)
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(heading(page)).toHaveText('Создание аккаунта')
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Получить код' }).click()
  await expect(heading(page)).toHaveText('Введите код')
}

test.describe('ссылки на экране входа', () => {
  test('почта на сервере настроена: есть «Создать аккаунт» и «Забыли пароль?»', async ({ page }) => {
    await openLogin(page)
    await expect(page.getByRole('button', { name: 'Создать аккаунт' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Забыли пароль?' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
  })

  test('почты на сервере нет: ссылок нет, вход как раньше', async ({ page }) => {
    await page.route(`${SERVER}/api/v1/auth/options`, (route) => route.fulfill({ json: { registration: false, password_reset: false } }))
    await openLogin(page)
    await expect(page.getByLabel('Пароль')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Создать аккаунт' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Забыли пароль?' })).toHaveCount(0)
  })

  test('регистрация и сброс включаются по отдельности', async ({ page }) => {
    await page.route(`${SERVER}/api/v1/auth/options`, (route) => route.fulfill({ json: { registration: false, password_reset: true } }))
    await openLogin(page)
    await expect(page.getByRole('button', { name: 'Забыли пароль?' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Создать аккаунт' })).toHaveCount(0)
  })

  test('сервер без этой ручки (старый): ссылок нет', async ({ page }) => {
    await page.route(`${SERVER}/api/v1/auth/options`, (route) => route.fulfill({ status: 404, json: { code: 'not_found', message: 'Не найдено' } }))
    await openLogin(page)
    await expect(page.getByRole('button', { name: 'Создать аккаунт' })).toHaveCount(0)
  })
})

test.describe('регистрация', () => {
  test('весь путь: e-mail, письмо, код, имя и пароль, человек в приложении', async ({ page }) => {
    await openFresh(page)
    // путь с самого начала: адрес сервера, потом вход, потом «Создать аккаунт»
    await page.getByLabel('Адрес сервера').fill(address)
    await page.getByRole('button', { name: 'Продолжить' }).click()
    await expect(heading(page)).toHaveText('Вход')
    await page.getByRole('button', { name: 'Создать аккаунт' }).click()

    // шаг 1
    await expect(heading(page)).toHaveText('Создание аккаунта')
    await expect(page.getByRole('button', { name: 'Получить код' })).toBeDisabled()
    await page.getByLabel('E-mail').fill(NEWBIE)
    await page.getByRole('button', { name: 'Получить код' }).click()

    // шаг 2: письмо пришло, подсказка называет адрес
    await expect(heading(page)).toHaveText('Введите код')
    await expect(page.locator('.sub')).toContainText(`Код отправлен на ${NEWBIE}`)
    const mail = await waitForMail(NEWBIE)
    expect(mail.subject).toBe('PlexoLab: код подтверждения')
    expect(mail.html).toContain('cid:logo')
    const submit = page.getByRole('button', { name: 'Создать аккаунт' })
    await expect(submit).toBeDisabled()

    await page.getByLabel('Код из письма').fill(codeOf(mail))
    await page.getByLabel('Как вас зовут').fill('Новичок Н.')
    await page.getByLabel(/^Пароль/).fill('новый-пароль-1')
    await expect(submit).toBeEnabled()
    await submit.click()

    // человек уже вошёл: в меню его имя, чужих проектов нет
    await expect(app(page)).toBeVisible()
    await expect(page.getByRole('button', { name: /Новичок Н\./ })).toBeVisible()
    await expect(page.getByText('Лена М.')).toHaveCount(0)

    // и дальше без вопросов, и обычный вход с выбранным паролем работает
    await page.reload()
    await expect(app(page)).toBeVisible()
    await page.getByRole('button', { name: /Новичок Н\./ }).click()
    await page.getByRole('menuitem', { name: 'Выйти' }).click()
    await expect(page.getByLabel('E-mail')).toHaveValue(NEWBIE)
    await page.getByLabel('Пароль').fill('новый-пароль-1')
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(app(page)).toBeVisible()
  })

  test('вставленный код «123 456» остаётся шестью цифрами, лишнее не набирается', async ({ page }) => {
    await askRegisterCode(page)
    const field = page.getByLabel('Код из письма')
    await field.fill(' 123 456 ')
    await expect(field).toHaveValue('123456')
    await field.fill('1234567890')
    await expect(field).toHaveValue('123456')
    await field.fill('abc12-3')
    await expect(field).toHaveValue('123')
  })

  test('неверный код: сколько осталось попыток, код очищен, имя и пароль остались; верный потом проходит', async ({ page }) => {
    await askRegisterCode(page)
    const mail = await waitForMail(NEWBIE)
    const right = codeOf(mail)
    const wrong = right === '000000' ? '000001' : '000000'

    await page.getByLabel('Как вас зовут').fill('Новичок Н.')
    await page.getByLabel(/^Пароль/).fill('новый-пароль-1')
    await page.getByLabel('Код из письма').fill(wrong)
    await page.getByRole('button', { name: 'Создать аккаунт' }).click()

    await expect(page.getByRole('alert')).toHaveText('Неверный код. Осталось попыток: 4')
    await expect(page.getByLabel('Код из письма')).toHaveValue('')
    await expect(page.getByLabel('Как вас зовут')).toHaveValue('Новичок Н.')
    await expect(page.getByLabel(/^Пароль/)).toHaveValue('новый-пароль-1')
    await expect(heading(page)).toHaveText('Введите код')

    await page.getByLabel('Код из письма').fill(right)
    await page.getByRole('button', { name: 'Создать аккаунт' }).click()
    await expect(app(page)).toBeVisible()
  })

  test('пять ошибок сжигают код: сообщение «запросите новый»', async ({ page }) => {
    await askRegisterCode(page)
    const right = codeOf(await waitForMail(NEWBIE))
    const wrong = right === '000000' ? '000001' : '000000'
    await page.getByLabel('Как вас зовут').fill('Новичок Н.')
    await page.getByLabel(/^Пароль/).fill('новый-пароль-1')

    for (let i = 0; i < 5; i++) {
      await page.getByLabel('Код из письма').fill(wrong)
      await page.getByRole('button', { name: 'Создать аккаунт' }).click()
      await expect(page.getByRole('alert')).toContainText('Неверный код')
    }
    await expect(page.getByRole('alert')).toHaveText('Неверный код. Попытки закончились, запросите новый')

    // верный код после этого уже не подходит
    await page.getByLabel('Код из письма').fill(right)
    await page.getByRole('button', { name: 'Создать аккаунт' }).click()
    await expect(page.getByRole('alert')).toHaveText('Код не подходит или устарел. Запросите новый')
    await expect(heading(page)).toHaveText('Введите код')
  })

  test('адрес уже занят: понятная ошибка, остаёмся на шаге 1', async ({ page }) => {
    await openLogin(page)
    await page.getByRole('button', { name: 'Создать аккаунт' }).click()
    await page.getByLabel('E-mail').fill('LENA@example.com')
    await page.getByRole('button', { name: 'Получить код' }).click()
    await expect(page.getByRole('alert')).toHaveText('Аккаунт с таким e-mail уже есть. Войдите или сбросьте пароль')
    await expect(heading(page)).toHaveText('Создание аккаунта')
    expect(readOutbox()).toHaveLength(0)
  })

  test('некорректный адрес: ошибка сервера показана на месте', async ({ page }) => {
    await openLogin(page)
    await page.getByRole('button', { name: 'Создать аккаунт' }).click()
    // «a@b» проходит проверку браузера (поле type=email), а сервер хочет точку в домене
    await page.getByLabel('E-mail').fill('a@b')
    await page.getByRole('button', { name: 'Получить код' }).click()
    await expect(page.getByRole('alert')).toHaveText('Некорректный e-mail')
    await expect(heading(page)).toHaveText('Создание аккаунта')
    expect(readOutbox()).toHaveLength(0)
  })

  test('«Отправить ещё раз» ждёт минуту; «Изменить e-mail» и тот же адрес не шлёт второе письмо', async ({ page }) => {
    await askRegisterCode(page)
    await waitForMail(NEWBIE)

    const again = page.getByRole('button', { name: /Отправить ещё раз через \d+ с/ })
    await expect(again).toBeDisabled()

    // вернулся к адресу, но код уже есть: просто открывается шаг с кодом
    await page.getByRole('button', { name: 'Изменить e-mail' }).click()
    await expect(heading(page)).toHaveText('Создание аккаунта')
    await expect(page.getByLabel('E-mail')).toHaveValue(NEWBIE)
    await page.getByRole('button', { name: 'Получить код' }).click()
    await expect(heading(page)).toHaveText('Введите код')
    expect(readOutbox().filter((m) => m.to === NEWBIE)).toHaveLength(1)
  })

  test('другой адрес после «Изменить e-mail» получает свой код', async ({ page }) => {
    await askRegisterCode(page)
    await waitForMail(NEWBIE)
    await page.getByRole('button', { name: 'Изменить e-mail' }).click()
    await page.getByLabel('E-mail').fill('second@example.com')
    await page.getByRole('button', { name: 'Получить код' }).click()
    await expect(page.locator('.sub')).toContainText('Код отправлен на second@example.com')
    await waitForMail('second@example.com')
  })

  test('«Вернуться ко входу» на обоих шагах, набранный e-mail остаётся', async ({ page }) => {
    await openLogin(page)
    await page.getByLabel('E-mail').fill('typed@example.com')
    await page.getByRole('button', { name: 'Создать аккаунт' }).click()
    await expect(page.getByLabel('E-mail')).toHaveValue('typed@example.com') // с экрана входа адрес пришёл сам
    await page.getByRole('button', { name: 'Вернуться ко входу' }).click()
    await expect(heading(page)).toHaveText('Вход')
    await expect(page.getByLabel('E-mail')).toHaveValue('typed@example.com')

    await page.getByRole('button', { name: 'Создать аккаунт' }).click()
    await page.getByRole('button', { name: 'Получить код' }).click()
    await expect(heading(page)).toHaveText('Введите код')
    await page.getByRole('button', { name: 'Вернуться ко входу' }).click()
    await expect(heading(page)).toHaveText('Вход')
  })

  test('регистрация приглашённого: приглашение в команду ждёт его в «Приглашениях»', async ({ page, request }) => {
    // Лена зовёт на адрес без аккаунта
    const login = await request.post(`${SERVER}/api/v1/auth/login`, { data: { email: 'lena@example.com', password: 'dev' } })
    const token = ((await login.json()) as { access_token: string }).access_token
    const headers = { Authorization: `Bearer ${token}` }
    const team = await request.post(`${SERVER}/api/v1/teams`, { headers, data: { name: 'Веб-команда' } })
    expect(team.status()).toBe(201)
    const teamId = ((await team.json()) as { id: string }).id
    const invite = await request.post(`${SERVER}/api/v1/teams/${teamId}/invites`, { headers, data: { email: NEWBIE } })
    expect(invite.status()).toBe(201)

    await askRegisterCode(page)
    await page.getByLabel('Код из письма').fill(codeOf(await waitForMail(NEWBIE)))
    await page.getByLabel('Как вас зовут').fill('Новичок Н.')
    await page.getByLabel(/^Пароль/).fill('новый-пароль-1')
    await page.getByRole('button', { name: 'Создать аккаунт' }).click()
    await expect(app(page)).toBeVisible()

    // у него сразу точка у имени, а в «Приглашениях» команда, куда его звали до регистрации
    await expect(page.locator('.invite-dot')).toBeVisible()
    await page.locator('.side button[aria-haspopup="menu"]').last().click()
    await page.getByRole('menuitem', { name: /^Приглашения/ }).click()
    const invites = page.getByRole('dialog', { name: 'Приглашения' })
    await expect(invites.locator('.proj-row', { hasText: 'Веб-команда' })).toContainText('Пригласил(а) Лена М.')
  })
})

test.describe('сброс пароля', () => {
  test('весь путь: «Забыли пароль?», письмо, код и новый пароль, человек в приложении, старый пароль не работает', async ({ page }) => {
    await openLogin(page)
    await page.getByLabel('E-mail').fill('lena@example.com')
    await page.getByRole('button', { name: 'Забыли пароль?' }).click()

    // шаг 1: набранный на входе e-mail уже стоит в поле
    await expect(heading(page)).toHaveText('Сброс пароля')
    await expect(page.getByLabel('E-mail')).toHaveValue('lena@example.com')
    await page.getByRole('button', { name: 'Получить код' }).click()

    // шаг 2
    await expect(heading(page)).toHaveText('Новый пароль')
    await expect(page.locator('.sub')).toContainText('Если аккаунт с адресом lena@example.com есть, мы отправили на него код')
    const mail = await waitForMail('lena@example.com')
    expect(mail.subject).toBe('PlexoLab: код для сброса пароля')
    await expect(page.getByLabel('Как вас зовут')).toHaveCount(0) // для сброса имя не нужно

    await page.getByLabel('Код из письма').fill(codeOf(mail))
    await page.getByLabel(/^Новый пароль/).fill('совсем-новый-пароль')
    await page.getByRole('button', { name: 'Сменить пароль' }).click()
    await expect(app(page)).toBeVisible()
    await expect(page.getByRole('button', { name: /Лена М\./ })).toBeVisible()

    // выход: со старым паролем не войти, с новым можно
    await page.getByRole('button', { name: /Лена М\./ }).click()
    await page.getByRole('menuitem', { name: 'Выйти' }).click()
    await page.getByLabel('Пароль').fill('dev')
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page.getByRole('alert')).toHaveText('Неверный e-mail или пароль')
    await page.getByLabel('Пароль').fill('совсем-новый-пароль')
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(app(page)).toBeVisible()
  })

  test('адрес без аккаунта: экран тот же, письма нет (по ответу не узнать, кто зарегистрирован)', async ({ page }) => {
    await openLogin(page)
    await page.getByRole('button', { name: 'Забыли пароль?' }).click()
    await page.getByLabel('E-mail').fill('nobody@example.com')
    await page.getByRole('button', { name: 'Получить код' }).click()
    await expect(heading(page)).toHaveText('Новый пароль')
    await expect(page.locator('.sub')).toContainText('Если аккаунт с адресом nobody@example.com есть')
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.waitForTimeout(500) // письмо, будь оно, уже лежало бы в папке: сервер шлёт его позади ответа
    expect(readOutbox()).toHaveLength(0)
  })

  test('неверный код при сбросе: пароль остаётся прежним', async ({ page }) => {
    await openLogin(page)
    await page.getByRole('button', { name: 'Забыли пароль?' }).click()
    await page.getByLabel('E-mail').fill('lena@example.com')
    await page.getByRole('button', { name: 'Получить код' }).click()
    const right = codeOf(await waitForMail('lena@example.com'))
    const wrong = right === '000000' ? '000001' : '000000'

    await page.getByLabel('Код из письма').fill(wrong)
    await page.getByLabel(/^Новый пароль/).fill('совсем-новый-пароль')
    await page.getByRole('button', { name: 'Сменить пароль' }).click()
    await expect(page.getByRole('alert')).toHaveText('Неверный код. Осталось попыток: 4')
    await expect(page.getByLabel('Код из письма')).toHaveValue('')

    // вход со старым паролем работает: ничего не поменялось
    await page.getByRole('button', { name: 'Вернуться ко входу' }).click()
    await page.getByLabel('Пароль').fill('dev')
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(app(page)).toBeVisible()
  })

  test('короткий новый пароль не отправляется: кнопка неактивна, пока нет 8 символов', async ({ page }) => {
    await openLogin(page)
    await page.getByRole('button', { name: 'Забыли пароль?' }).click()
    await page.getByLabel('E-mail').fill('lena@example.com')
    await page.getByRole('button', { name: 'Получить код' }).click()
    await page.getByLabel('Код из письма').fill(codeOf(await waitForMail('lena@example.com')))
    const submit = page.getByRole('button', { name: 'Сменить пароль' })
    await page.getByLabel(/^Новый пароль/).fill('1234567')
    await expect(submit).toBeDisabled()
    await page.getByLabel(/^Новый пароль/).fill('12345678')
    await expect(submit).toBeEnabled()
  })

  test('сброс на другом устройстве завершает прежнюю сессию', async ({ browser, page }) => {
    // первое «устройство»: Лена вошла и работает
    await openLogin(page)
    await page.getByLabel('E-mail').fill('lena@example.com')
    await page.getByLabel('Пароль').fill('dev')
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(app(page)).toBeVisible()
    await page.waitForTimeout(300)

    // второе: сбрасывает пароль
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU', timezoneId: 'UTC', reducedMotion: 'reduce' })
    const other = await context.newPage()
    await openLogin(other)
    await other.getByRole('button', { name: 'Забыли пароль?' }).click()
    await other.getByLabel('E-mail').fill('lena@example.com')
    await other.getByRole('button', { name: 'Получить код' }).click()
    await other.getByLabel('Код из письма').fill(codeOf(await waitForMail('lena@example.com')))
    await other.getByLabel(/^Новый пароль/).fill('совсем-новый-пароль')
    await other.getByRole('button', { name: 'Сменить пароль' }).click()
    await expect(app(other)).toBeVisible()
    await context.close()

    // первое: сохранённый вход больше не действует, после перезапуска просит войти
    await page.reload()
    await expect(heading(page)).toHaveText('Вход')
  })
})

// Эталона из макета у этих экранов нет: снимки свои, как у окон «Настройки» и «Команда»
for (const theme of ['light', 'dark'] as const) {
  test.describe(`снимки экранов, тема: ${theme}`, () => {
    test('вход с новыми ссылками', async ({ page }) => {
      await openLogin(page, theme)
      await page.mouse.move(8, 8)
      await expect(page.locator('main')).toHaveScreenshot(`login-links-${theme}.png`)
    })

    test('создание аккаунта: шаг 1 и шаг 2', async ({ page }) => {
      await openLogin(page, theme)
      await page.getByRole('button', { name: 'Создать аккаунт' }).click()
      await page.mouse.move(8, 8)
      await expect(page.locator('main')).toHaveScreenshot(`register-email-${theme}.png`)

      await page.getByLabel('E-mail').fill(NEWBIE)
      await page.getByRole('button', { name: 'Получить код' }).click()
      await expect(heading(page)).toHaveText('Введите код')
      await page.getByLabel('Код из письма').fill('123456')
      await page.getByLabel('Как вас зовут').fill('Новичок Н.')
      await page.mouse.move(8, 8)
      // счётчик «ещё раз через N с» тикает: в снимок он не входит
      await expect(page.locator('main')).toHaveScreenshot(`register-code-${theme}.png`, { mask: [page.getByRole('button', { name: /Отправить ещё раз/ })] })
    })

    test('сброс пароля: шаг 2 с ошибкой', async ({ page }) => {
      await openLogin(page, theme)
      await page.getByRole('button', { name: 'Забыли пароль?' }).click()
      await page.getByLabel('E-mail').fill('lena@example.com')
      await page.getByRole('button', { name: 'Получить код' }).click()
      await expect(heading(page)).toHaveText('Новый пароль')
      await page.getByLabel('Код из письма').fill('000000')
      await page.getByLabel(/^Новый пароль/).fill('совсем-новый-пароль')
      await page.getByRole('button', { name: 'Сменить пароль' }).click()
      await expect(page.getByRole('alert')).toBeVisible()
      await page.mouse.move(8, 8)
      await expect(page.locator('main')).toHaveScreenshot(`reset-code-${theme}.png`, { mask: [page.getByRole('button', { name: /Отправить ещё раз/ })] })
    })
  })
}
