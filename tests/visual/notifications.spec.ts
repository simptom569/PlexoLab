import { expect, test, type Browser, type Page } from '@playwright/test'
import { openApp, resetData, SERVER } from './fixtures'
import { cutOffAndWait } from './offline-helpers'
import { api } from './wiki-helpers'

// Этап Н3 (docs/OFFLINE-NOTIFY-SEARCH.md, раздел 2): «@» в комментарии открывает список участников проекта, упоминание
// показано именем, адресату приходит уведомление (счётчик в меню пользователя, окно «Уведомления»), нажатие открывает задачу.
// Лена (основное окно) пишет и назначает, Артём (второе окно) получает. Люди и данные из сида.

test.beforeEach(() => resetData())

const card = (page: Page, key: string) => page.locator('[data-card-id]', { hasText: key })
const drawer = (page: Page) => page.getByRole('dialog', { name: /^Задача / })
const composer = (page: Page) => drawer(page).getByLabel('Комментарий')
const picker = (page: Page) => page.getByRole('listbox', { name: 'Кого упомянуть' })
const userButton = (page: Page) => page.locator('.side button[aria-haspopup="menu"]')
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Уведомления' })
const rows = (page: Page) => dialog(page).getByRole('listitem')

/** Артём: отдельное окно браузера со своим входом, как второй человек за другим компьютером */
async function artem(browser: Browser, settings: Record<string, unknown> = {}): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU', timezoneId: 'UTC', reducedMotion: 'reduce' })
  const page = await context.newPage()
  await openApp(page, { email: 'artem@example.com', settings })
  return { page, close: () => context.close() }
}

/** Запрос к серверу от имени другого человека (`api` из wiki-helpers всегда от Лены) */
async function apiAs<T>(page: Page, email: string, path: string, init: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; data?: unknown } = {}): Promise<T> {
  const login = await page.request.post(`${SERVER}/api/v1/auth/login`, { data: { email, password: 'dev' } })
  const { access_token } = (await login.json()) as { access_token: string }
  const res = await page.request.fetch(`${SERVER}/api/v1${path}`, {
    method: init.method ?? 'GET',
    data: init.data,
    headers: { Authorization: `Bearer ${access_token}` },
  })
  expect(res.ok(), `${init.method ?? 'GET'} ${path}: ${res.status()}`).toBeTruthy()
  return res.status() === 204 ? (undefined as T) : ((await res.json()) as T)
}

type Task = { id: string; key: string; title: string }
type Board = { tasks: Task[] }
type Project = { id: string; key: string | null; name: string }
type Users = Array<{ id: string; name: string; email: string }>

const projects = (page: Page) => api<Project[]>(page, '/projects')
const projectByKey = async (page: Page, key: string) => (await projects(page)).find((p) => p.key === key)!
const taskByKey = async (page: Page, key: string) => {
  const project = await projectByKey(page, key.split('-')[0]!)
  return (await api<Board>(page, `/projects/${project.id}/board`)).tasks.find((t) => t.key === key)!
}
const userId = async (page: Page, email: string) => (await api<Users>(page, '/users')).find((u) => u.email === email)!.id

const myUnread = async (page: Page, email: string) =>
  (await apiAs<{ unread: number }>(page, email, '/notifications')).unread

async function openTask(page: Page, key: string) {
  await card(page, key).locator('.card-title').click()
  await expect(drawer(page)).toBeVisible()
}

async function openNotifications(page: Page) {
  await userButton(page).click()
  await page.getByRole('menuitem', { name: /^Уведомления/ }).click()
  await expect(dialog(page)).toBeVisible()
}

// ===== Набор «@» в комментарии =====

test.describe('список по «@» в комментарии', () => {
  test('«@» и начало имени открывают список участников проекта, Enter вставляет имя, комментарий уходит с меткой', async ({ page }) => {
    await openApp(page)
    await openTask(page, 'WEB-141')
    await composer(page).click()
    await page.keyboard.type('Привет @ар')

    await expect(picker(page)).toBeVisible()
    await expect(picker(page).getByRole('option')).toHaveCount(1)
    await expect(picker(page).getByRole('option', { name: 'Артём К.' })).toBeVisible()
    await expect(composer(page)).toHaveAttribute('aria-controls', /./) // поле остаётся текстовым и ссылается на открытый список
    await expect(page.getByRole('textbox', { name: 'Комментарий' })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(picker(page)).toHaveCount(0)
    await expect(composer(page)).toHaveValue('Привет @Артём К. ')
    await page.keyboard.type('посмотри, пожалуйста')

    await drawer(page).getByRole('button', { name: 'Отправить' }).click()
    const body = drawer(page).locator('.comment .bubble').last()
    await expect(body).toContainText('Привет @Артём К. посмотри, пожалуйста')
    await expect(body.locator('.mention')).toHaveText('@Артём К.')
    await expect(body.locator('.mention.me')).toHaveCount(0) // это упоминание Артёма, а не меня

    // на сервере в тексте метка, а не имя, и список упомянутых
    const task = await taskByKey(page, 'WEB-141')
    const detail = await api<{ comments: Array<{ body: string; mentions: string[] }> }>(page, `/tasks/${task.id}`)
    const last = detail.comments.at(-1)!
    const id = await userId(page, 'artem@example.com')
    expect(last.body).toBe(`Привет @[${id}] посмотри, пожалуйста`)
    expect(last.mentions).toEqual([id])
  })

  test('«@» без запроса показывает людей, кроме меня самого; стрелки двигают выбор, нажатие мышью вставляет', async ({ page }) => {
    await openApp(page)
    await openTask(page, 'WEB-141')
    await composer(page).click()
    await page.keyboard.type('@')

    const names = await picker(page).getByRole('option').allTextContents()
    expect(names.length).toBeGreaterThanOrEqual(3)
    expect(names.some((n) => n.includes('Лена М.'))).toBe(false)
    await expect(picker(page).getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowDown')
    await expect(picker(page).getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(composer(page)).toHaveAttribute('aria-activedescendant', /-1$/)
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp') // с первого по кругу на последнего
    await expect(picker(page).getByRole('option').last()).toHaveAttribute('aria-selected', 'true')

    await picker(page).getByRole('option', { name: 'Даниил С.' }).click()
    await expect(composer(page)).toHaveValue('@Даниил С. ')
    await expect(picker(page)).toHaveCount(0)
    await expect(composer(page)).toBeFocused()
  })

  test('Esc закрывает список и не трогает текст; Tab тоже выбирает; почта и посторонние слова списка не открывают', async ({ page }) => {
    await openApp(page)
    await openTask(page, 'WEB-141')
    await composer(page).click()
    await page.keyboard.type('Привет @со')
    await expect(picker(page).getByRole('option')).toHaveCount(1)
    await expect(picker(page).getByRole('option', { name: 'Соня В.' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(picker(page)).toHaveCount(0)
    await expect(drawer(page)).toBeVisible() // Esc не закрыл панель задачи
    await expect(composer(page)).toHaveValue('Привет @со')
    await page.keyboard.type('н') // та же «@»: список остаётся закрытым
    await expect(picker(page)).toHaveCount(0)

    await page.keyboard.type(' и @ар')
    await expect(picker(page).getByRole('option', { name: 'Артём К.' })).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(composer(page)).toHaveValue('Привет @сон и @Артём К. ')

    await page.keyboard.type('почта a@b.c')
    await expect(picker(page)).toHaveCount(0)
    await page.keyboard.type(' @яяя')
    await expect(picker(page)).toHaveCount(0) // никого с таким именем
  })

  test('имя, которое поправили руками, меткой не становится: Артёму ничего не придёт', async ({ page }) => {
    await openApp(page)
    await openTask(page, 'WEB-141')
    await composer(page).click()
    await page.keyboard.type('@ар')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Backspace') // убрал пробел
    await page.keyboard.press('Backspace') // и точку у «К.»
    await page.keyboard.type('ирилл просто текст') // теперь это уже другое имя
    await drawer(page).getByRole('button', { name: 'Отправить' }).click()
    await expect(drawer(page).locator('.comment .bubble').last()).toContainText('@Артём Кирилл просто текст')
    await expect(drawer(page).locator('.mention')).toHaveCount(0)
    expect(await myUnread(page, 'artem@example.com')).toBe(0)
  })

  test('упоминание в уже написанном комментарии показано именем человека, каким оно стало потом', async ({ page }) => {
    await openApp(page)
    const task = await taskByKey(page, 'WEB-141')
    const id = await userId(page, 'artem@example.com')
    await api(page, `/tasks/${task.id}/comments`, { method: 'POST', data: { body: `Привет @[${id}] и @[${await userId(page, 'lena@example.com')}]` } })
    await apiAs(page, 'artem@example.com', '/me', { method: 'PATCH', data: { name: 'Артём Каменев' } })
    await page.reload()
    await openTask(page, 'WEB-141')
    const body = drawer(page).locator('.comment .bubble').last()
    await expect(body.locator('.mention').first()).toHaveText('@Артём Каменев')
    await expect(body.locator('.mention.me')).toHaveText('@Лена М.') // меня самого выделено сильнее
  })
})

// ===== Уведомление адресату =====

test.describe('уведомления', () => {
  test('упоминание: у Артёма сразу счётчик и точка, в окне строка с цитатой, нажатие открывает задачу и отмечает прочитанным', async ({ page, browser }) => {
    await openApp(page)
    const second = await artem(browser)
    try {
      await expect(card(second.page, 'WEB-141')).toBeVisible()
      await expect(second.page.locator('.invite-dot')).toHaveCount(0)

      await openTask(page, 'WEB-141')
      await composer(page).click()
      await page.keyboard.type('@ар')
      await page.keyboard.press('Enter')
      await page.keyboard.type('посмотри, пожалуйста')
      await drawer(page).getByRole('button', { name: 'Отправить' }).click()

      // чужое окно узнаёт сразу: точка у имени и число у пункта меню
      await expect(second.page.locator('.invite-dot')).toHaveAccessibleName('Есть непрочитанные уведомления', { timeout: 3000 })
      await userButton(second.page).click()
      await expect(second.page.getByRole('menuitem', { name: /^Уведомления/ })).toContainText('1')
      await second.page.keyboard.press('Escape')

      await openNotifications(second.page)
      await expect(rows(second.page)).toHaveCount(1)
      const row = rows(second.page).first()
      await expect(row).toContainText('Вас упомянули в комментарии')
      await expect(row).toContainText('WEB-141')
      await expect(row).toContainText('Тёмная тема для страницы настроек')
      await expect(row).toContainText('@Артём К. посмотри, пожалуйста') // метка заменена именем
      await expect(row).toContainText('Лена М.')
      await expect(row.getByRole('img', { name: 'Не прочитано' })).toBeVisible()

      await row.click()
      await expect(dialog(second.page)).toHaveCount(0)
      await expect(drawer(second.page)).toBeVisible()
      await expect(drawer(second.page).getByText('WEB-141', { exact: true })).toBeVisible()
      await expect(second.page.locator('.invite-dot')).toHaveCount(0)
      expect(await myUnread(page, 'artem@example.com')).toBe(0)
    } finally {
      await second.close()
    }
  })

  test('назначение исполнителем: Артёму приходит «Вас назначили исполнителем»; себя назначать не сообщается', async ({ page, browser }) => {
    await openApp(page)
    const second = await artem(browser)
    try {
      await expect(card(second.page, 'WEB-141')).toBeVisible()
      await openTask(page, 'WEB-141')
      await drawer(page).getByRole('button', { name: 'Артём К.', exact: true }).first().click()

      await expect(second.page.locator('.invite-dot')).toBeVisible({ timeout: 3000 })
      await openNotifications(second.page)
      const row = rows(second.page).first()
      await expect(row).toContainText('Вас назначили исполнителем')
      await expect(row).toContainText('WEB-141')
      await expect(row).toContainText('Лена М.')

      // Лена назначила на себя другую задачу: себе уведомление не приходит
      await drawer(page).getByRole('button', { name: 'Закрыть', exact: true }).click()
      await openTask(page, 'WEB-139')
      await drawer(page).getByRole('button', { name: 'Лена М.', exact: true }).first().click()
      expect(await myUnread(page, 'lena@example.com')).toBe(0)
    } finally {
      await second.close()
    }
  })

  test('уведомление из другого проекта: нажатие переключает проект и открывает задачу', async ({ page, browser }) => {
    await openApp(page)
    const mobile = await projectByKey(page, 'API')
    const created = await api<{ id: string; key: string }>(page, `/projects/${mobile.id}/tasks`, { method: 'POST', data: { title: 'Задача мобильного приложения' } })
    await api(page, `/tasks/${created.id}`, { method: 'PATCH', data: { assignee_id: await userId(page, 'artem@example.com') } })

    const second = await artem(browser) // открыт проект «Web-приложение»
    try {
      await expect(card(second.page, 'WEB-141')).toBeVisible()
      await openNotifications(second.page)
      await rows(second.page).first().click()
      await expect(second.page.locator('.side').getByText('Мобильный API')).toBeVisible()
      await expect(drawer(second.page)).toBeVisible()
      await expect(drawer(second.page).getByLabel('Название задачи')).toHaveValue('Задача мобильного приложения')
      await expect(second.page.getByRole('heading', { name: 'Доска', level: 1 })).toBeVisible()
    } finally {
      await second.close()
    }
  })

  test('«Прочитать все» и отметка в другом окне обновляют счётчик везде сразу', async ({ page, browser }) => {
    await openApp(page)
    const task = await taskByKey(page, 'WEB-141')
    const artemId = await userId(page, 'artem@example.com')
    for (const text of ['раз', 'два']) {
      await api(page, `/tasks/${task.id}/comments`, { method: 'POST', data: { body: `${text} @[${artemId}]` } })
    }
    const first = await artem(browser)
    const other = await artem(browser) // то же приложение, второе окно этого же человека
    try {
      for (const p of [first.page, other.page]) {
        await userButton(p).click()
        await expect(p.getByRole('menuitem', { name: /^Уведомления/ })).toContainText('2')
        await p.keyboard.press('Escape')
      }
      await openNotifications(first.page)
      await expect(dialog(first.page)).toContainText('Непрочитанных: 2')
      await rows(first.page).last().click() // открыл одно: прочитано
      await expect(first.page.locator('.invite-dot')).toBeVisible() // второе ещё нет
      await expect.poll(() => myUnread(page, 'artem@example.com')).toBe(1)
      await expect(other.page.locator('.invite-dot')).toBeVisible()
      await userButton(other.page).click()
      await expect(other.page.getByRole('menuitem', { name: /^Уведомления/ })).toContainText('1', { timeout: 3000 })

      await other.page.getByRole('menuitem', { name: /^Уведомления/ }).click()
      await expect(dialog(other.page)).toContainText('Непрочитанных: 1')
      await dialog(other.page).getByRole('button', { name: 'Прочитать все' }).click()
      await expect(dialog(other.page)).toContainText('Всё прочитано')
      await expect(dialog(other.page).getByRole('button', { name: 'Прочитать все' })).toBeDisabled()
      await expect(other.page.locator('.invite-dot')).toHaveCount(0)
      await expect(first.page.locator('.invite-dot')).toHaveCount(0, { timeout: 3000 }) // первое окно тоже узнало
      expect(await myUnread(page, 'artem@example.com')).toBe(0)
    } finally {
      await first.close()
      await other.close()
    }
  })

  test('без уведомлений: окно пишет об этом; в просмотре без связи «Прочитать все» закрыто', async ({ page }) => {
    await openApp(page)
    await openNotifications(page)
    await expect(dialog(page)).toContainText('Уведомлений нет')
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)

    // пришло одно: в просмотре без связи читать и открывать можно, отмечать нельзя
    const task = await taskByKey(page, 'WEB-141')
    await apiAs(page, 'artem@example.com', `/tasks/${task.id}/comments`, {
      method: 'POST',
      data: { body: `@[${await userId(page, 'lena@example.com')}] привет` },
    })
    await expect(page.locator('.invite-dot')).toBeVisible({ timeout: 3000 })
    await cutOffAndWait(page)
    await openNotifications(page)
    await expect(rows(page)).toHaveCount(1)
    await expect(dialog(page).getByRole('button', { name: 'Прочитать все' })).toBeDisabled()
  })

  test('приглашение и уведомление вместе: точка одна, подпись называет оба', async ({ page, browser }) => {
    await openApp(page)
    const second = await artem(browser)
    try {
      await expect(card(second.page, 'WEB-141')).toBeVisible()
      const task = await taskByKey(page, 'WEB-141')
      await api(page, `/tasks/${task.id}/comments`, { method: 'POST', data: { body: `привет @[${await userId(page, 'artem@example.com')}]` } })
      await expect(second.page.locator('.invite-dot')).toHaveAccessibleName('Есть непрочитанные уведомления', { timeout: 3000 })
      await expect(second.page.locator('.invite-dot')).toHaveCount(1)
    } finally {
      await second.close()
    }
  })
})

// ===== Внешний вид =====

for (const theme of ['light', 'dark'] as const) {
  test(`окно «Уведомления» и список по «@» (${theme}) собраны из переменных темы`, async ({ page, browser }) => {
    await openApp(page, { theme })
    const task = await taskByKey(page, 'WEB-141')
    const artemId = await userId(page, 'artem@example.com')
    await api(page, `/tasks/${task.id}/comments`, { method: 'POST', data: { body: `@[${artemId}] посмотри, пожалуйста, эту задачу до пятницы, нужен твой взгляд на тёмную тему` } })
    await api(page, `/tasks/${task.id}`, { method: 'PATCH', data: { assignee_id: artemId } })

    const second = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU', timezoneId: 'UTC', reducedMotion: 'reduce' })
    const view = await second.newPage()
    try {
      await openApp(view, { email: 'artem@example.com', theme })
      await openNotifications(view)
      await expect(rows(view)).toHaveCount(2)
      await rows(view).last().click() // прочитанная строка рядом с непрочитанной
      await drawer(view).getByRole('button', { name: 'Закрыть', exact: true }).click()
      await openNotifications(view)
      await view.mouse.move(5, 5)
      await expect(view).toHaveScreenshot(`notifications-${theme}.png`)
      await view.keyboard.press('Escape')
    } finally {
      await second.close()
    }

    // список по «@» и подсвеченное упоминание в панели задачи
    await openTask(page, 'WEB-141')
    await composer(page).click()
    await page.keyboard.type('@')
    await expect(picker(page)).toBeVisible()
    await page.mouse.move(5, 5)
    await expect(page).toHaveScreenshot(`mention-picker-${theme}.png`)
  })
}
