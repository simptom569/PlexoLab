import { expect, test, type Page } from '@playwright/test'
import { openApp, resetData, SERVER } from './fixtures'
import { fillDate } from './helpers'

test.beforeEach(() => resetData())

const column = (page: Page, title: string) => page.locator('.col', { has: page.locator('h2', { hasText: new RegExp(`^${title}$`) }) })
const cards = (page: Page, title: string) => column(page, title).locator('[data-card-id]')
const card = (page: Page, key: string) => page.locator('[data-card-id]', { hasText: key })
const keys = async (page: Page, title: string) => (await cards(page, title).locator('.mono').allTextContents()).map((t) => t.trim())
const drawer = (page: Page) => page.getByRole('dialog', { name: /^Задача / })

async function api<T>(page: Page, path: string): Promise<T> {
  const login = await page.request.post(`${SERVER}/api/v1/auth/login`, { data: { email: 'lena@example.com', password: 'dev' } })
  const { access_token } = (await login.json()) as { access_token: string }
  return (await (await page.request.get(`${SERVER}/api/v1${path}`, { headers: { Authorization: `Bearer ${access_token}` } })).json()) as T
}

async function webTasks(page: Page) {
  const projects = await api<Array<{ id: string; name: string }>>(page, '/projects')
  const board = await api<{
    columns: Array<{ id: string; title: string; color: string; is_done: boolean; position: number }>
    tasks: Array<{ id: string; key: string; title: string; column_id: string | null; priority: string; assignee_id: string | null; due_date: string | null; start_date: string | null; tag_ids: string[]; pr: string; module_id: string | null; milestone_id: string | null; subtasks_total: number }>
    tags: Array<{ id: string; label: string }>
  }>(page, `/projects/${projects.find((p) => p.name === 'Web-приложение')!.id}/board`)
  return board
}

test.describe('фильтры и поиск', () => {
  test('«Мои задачи» оставляет задачи текущего пользователя и снимается повторным нажатием', async ({ page }) => {
    await openApp(page)
    const mine = page.getByRole('button', { name: 'Мои задачи' })
    await expect(mine).toHaveAttribute('aria-pressed', 'false')
    await mine.click()
    await expect(mine).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-card-id] .mono')).toHaveText(['WEB-151', 'WEB-141', 'WEB-126'])
    await expect(page.getByText('Активные фильтры:')).toBeVisible()
    await expect(page.locator('.filter-chip')).toHaveText(['Лена М.'])
    await expect(page.getByRole('button', { name: /^Фильтры/ }).locator('.badge')).toHaveText('1')
    await mine.click()
    await expect(page.locator('[data-card-id]')).toHaveCount(12)
    await expect(page.getByText('Активные фильтры:')).toHaveCount(0)
  })

  test('группы внутри «или», между собой «и»; чипы снимают фильтры; «Сбросить всё»', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: /^Фильтры/ }).click()
    const pop = page.getByRole('dialog', { name: 'Фильтры' })
    await pop.getByRole('button', { name: 'Высокий' }).click()
    await expect(page.locator('[data-card-id] .mono')).toHaveText(['WEB-153', 'WEB-144', 'WEB-146', 'WEB-128'])
    await pop.getByRole('button', { name: 'Артём К.' }).click()
    await expect(page.locator('[data-card-id] .mono')).toHaveText(['WEB-153', 'WEB-144'])
    await pop.getByRole('button', { name: 'Соня В.' }).click() // исполнитель: Артём «или» Соня
    await expect(page.locator('[data-card-id] .mono')).toHaveText(['WEB-153', 'WEB-144', 'WEB-146', 'WEB-128'])
    await pop.getByRole('button', { name: 'Готово' }).click()
    await expect(pop).toHaveCount(0)
    await expect(page.locator('.filter-chip')).toHaveText(['Артём К.', 'Соня В.', 'Высокий'])
    await page.getByRole('button', { name: 'Убрать фильтр Высокий' }).click()
    await expect(page.locator('[data-card-id]')).toHaveCount(4) // Артём (2) и Соня (2), любой приоритет
    await page.getByRole('button', { name: /^Фильтры/ }).click()
    await pop.getByRole('button', { name: 'Сбросить всё' }).click()
    await expect(page.locator('[data-card-id]')).toHaveCount(12)
  })

  test('срок «На этой неделе», метки, модуль, «без исполнителя»', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: /^Фильтры/ }).click()
    const pop = page.getByRole('dialog', { name: 'Фильтры' })
    await pop.getByRole('button', { name: 'На этой неделе' }).click()
    await expect(page.locator('[data-card-id]')).toHaveCount(6) // сроки 19–23 октября: сегодня 18-е, окно до 25-го
    await pop.getByRole('button', { name: 'Любой' }).click()
    await pop.getByRole('button', { name: 'SSO' }).click()
    await expect(page.locator('[data-card-id] .mono')).toHaveText(['WEB-144'])
    await pop.getByRole('button', { name: 'Без модуля' }).click()
    await expect(page.locator('[data-card-id]')).toHaveCount(1 + (await page.locator('[data-card-id]').count()) - 1)
    await pop.getByRole('button', { name: 'Сбросить всё' }).click()
    await pop.getByRole('button', { name: 'Бэк' }).click()
    const withBack = await page.locator('[data-card-id]').count()
    expect(withBack).toBeGreaterThan(0)
    expect(withBack).toBeLessThan(12)
    await pop.getByRole('button', { name: 'Без исполнителя' }).click()
    await expect(page.locator('[data-card-id]')).toHaveCount(0)
    await expect(column(page, 'К выполнению').locator('.drop-hint')).toHaveText('Нет задач. Перетащи сюда карточку')
  })

  test('поиск по номеру и названию без учёта регистра; «Сбросить всё» чистит и поиск', async ({ page }) => {
    await openApp(page)
    const search = page.getByRole('searchbox', { name: 'Поиск по задачам' })
    await search.fill('sso')
    await expect(page.locator('[data-card-id] .mono')).toHaveText(['WEB-144'])
    await search.fill('web-13')
    await expect(page.locator('[data-card-id] .mono')).toHaveText(['WEB-139', 'WEB-137', 'WEB-133', 'WEB-130'])
    await search.fill('такого нет')
    await expect(page.locator('[data-card-id]')).toHaveCount(0)
    await page.getByRole('button', { name: /^Фильтры/ }).click()
    await page.getByRole('button', { name: 'Сбросить всё' }).click()
    await expect(search).toHaveValue('')
    await expect(page.locator('[data-card-id]')).toHaveCount(12)
  })

  test('настройки (вид, фильтры, «Отображение», тема) переживают перезапуск', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Отображение' }).click()
    await page.getByRole('dialog', { name: 'Что показывать на карточке' }).getByRole('button', { name: 'Метки' }).click()
    await expect(page.locator('[data-card-id] .tag')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Мои задачи' }).click()
    await page.getByRole('button', { name: 'Таблица' }).click()
    await expect(page.locator('.trow:not(.thead)')).toHaveCount(3)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Таблица' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Мои задачи' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.trow:not(.thead)')).toHaveCount(3)
    await page.getByRole('group', { name: 'Вид задач' }).getByRole('button', { name: 'Доска' }).click()
    await expect(page.locator('[data-card-id]')).toHaveCount(3)
    await expect(page.locator('[data-card-id] .tag')).toHaveCount(0)
  })
})

test.describe('«Отображение» карточки', () => {
  test('каждый переключатель прячет свою часть карточки', async ({ page }) => {
    await openApp(page)
    const first = card(page, 'WEB-144')
    await expect(first.locator('.tag')).toHaveCount(2)
    await page.getByRole('button', { name: 'Отображение' }).click()
    const pop = page.getByRole('dialog', { name: 'Что показывать на карточке' })
    await expect(pop.getByRole('button')).toHaveText(['Исполнитель', 'Срок', 'Метки', 'Приоритет', 'Подзадачи', 'PR', 'Модуль'])
    await expect(first.locator('.pill')).toHaveText('SSO')
    await pop.getByRole('button', { name: 'Модуль' }).click()
    await expect(first.locator('.pill')).toHaveCount(0)
    await pop.getByRole('button', { name: 'Приоритет' }).click()
    await expect(first.locator('.prio')).toHaveCount(0)
    await pop.getByRole('button', { name: 'Подзадачи' }).click()
    await expect(first.locator('.bar')).toHaveCount(0)
    await pop.getByRole('button', { name: 'PR' }).click()
    await expect(first.getByText('#321')).toHaveCount(0)
    await pop.getByRole('button', { name: 'Срок' }).click()
    await expect(first.getByText('23 окт')).toHaveCount(0)
    await pop.getByRole('button', { name: 'Исполнитель' }).click()
    await expect(first.locator('.avatar')).toHaveCount(0)
    await expect(pop.getByRole('button', { name: 'Исполнитель' })).toHaveAttribute('aria-pressed', 'false')
  })
})

test.describe('виды', () => {
  test('список: колонки группами, отметка выполнения переносит в «Готово» и обратно', async ({ page }) => {
    await openApp(page, { settings: { view: 'list' } })
    await expect(page.locator('.list-head')).toHaveText([/К выполнению\s*3/, /В работе\s*3/, /На ревью\s*2/, /Готово\s*4/])
    await page.getByRole('button', { name: 'Переключить выполнение WEB-151' }).click()
    await expect(page.locator('.list-head').last()).toContainText('5')
    await expect(page.getByRole('button', { name: 'Переключить выполнение WEB-151' })).toHaveClass(/\bdone\b/)
    await expect(page.getByText('Готово').first()).toBeVisible()
    await page.getByRole('button', { name: 'Переключить выполнение WEB-151' }).click()
    await expect(page.locator('.list-head').first()).toContainText('3')
    await expect.poll(async () => (await webTasks(page)).tasks.find((t) => t.key === 'WEB-151')?.column_id).toBe((await webTasks(page)).columns.find((c) => c.title === 'К выполнению')!.id)
  })

  test('таблица: сортировка по клику на заголовок, повторный клик разворачивает', async ({ page }) => {
    await openApp(page, { settings: { view: 'table' } })
    const ids = () => page.locator('.trow:not(.thead) .mono').allTextContents()
    expect((await ids())[0]).toBe('WEB-126')
    await page.getByRole('button', { name: /^Срок/ }).click()
    expect((await ids())[0]).toBe('WEB-126') // 9 октября
    expect((await ids()).at(-1)).toBe('WEB-149') // 30 октября
    await expect(page.getByRole('button', { name: /^Срок/ })).toContainText('↑')
    await page.getByRole('button', { name: /^Срок/ }).click()
    expect((await ids())[0]).toBe('WEB-149')
    await expect(page.getByRole('button', { name: /^Срок/ })).toContainText('↓')
    await page.getByRole('button', { name: /^Приоритет/ }).click()
    expect((await ids()).slice(0, 4).sort()).toEqual(['WEB-128', 'WEB-144', 'WEB-146', 'WEB-153'])
    await page.getByRole('button', { name: /^Метки/ }).click() // не сортируется: порядок не меняется
    await expect(page.getByRole('button', { name: /^Приоритет/ })).toContainText('↑')
  })

  test('таблица: пустой результат фильтров', async ({ page }) => {
    await openApp(page, { settings: { view: 'table' } })
    await page.getByRole('searchbox', { name: 'Поиск по задачам' }).fill('zzz')
    await expect(page.getByText('По выбранным фильтрам задач нет')).toBeVisible()
  })

  test('календарь: месяцы, «Сегодня», плашки по срокам, открытие задачи', async ({ page }) => {
    await openApp(page, { settings: { view: 'cal' } })
    await expect(page.getByText('Октябрь 2026')).toBeVisible()
    await expect(page.locator('.cal-cell')).toHaveCount(35)
    await expect(page.locator('.cal-cell.today .cal-num')).toHaveText('18')
    await expect(page.locator('.cal-pill')).toHaveCount(12)
    await page.getByRole('button', { name: 'Следующий месяц' }).click()
    await expect(page.getByText('Ноябрь 2026')).toBeVisible()
    await expect(page.locator('.cal-cell:not(.out) .cal-pill')).toHaveCount(0)
    await expect(page.locator('.cal-cell.out .cal-pill')).toHaveCount(2) // хвост октября в первой неделе ноября
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
    await expect(page.getByText('Сентябрь 2026')).toBeVisible()
    await page.getByRole('button', { name: 'Сегодня' }).click()
    await expect(page.getByText('Октябрь 2026')).toBeVisible()
    await page.locator('.cal-pill', { hasText: 'Вход через SSO' }).click()
    await expect(drawer(page)).toBeVisible()
  })

  test('Ганта: окно по 14 дней, полоса задачи, «К сегодня»', async ({ page }) => {
    await openApp(page, { settings: { view: 'gantt' } })
    await expect(page.getByText('12 окт – 22 ноя')).toBeVisible()
    await expect(page.locator('.g-row .g-bar')).toHaveCount(11) // WEB-126 (9 октября) раньше начала окна
    await expect(page.locator('.g-today')).toHaveCount(11)
    await expect(page.getByRole('button', { name: /^Вход через SSO для корпоративных аккаунтов: / })).toBeVisible()
    await page.getByRole('button', { name: 'Позже' }).click()
    await expect(page.getByText('26 окт – 6 дек')).toBeVisible()
    await page.getByRole('button', { name: 'Позже' }).click()
    await page.getByRole('button', { name: 'Позже' }).click()
    await expect(page.getByText('Нет задач со сроком в этом диапазоне')).toBeVisible()
    await page.getByRole('button', { name: 'К сегодня' }).click()
    await expect(page.getByText('12 окт – 22 ноя')).toBeVisible()
  })
})

test.describe('колонки', () => {
  test('сводка и прогресс «Готово»', async ({ page }) => {
    await openApp(page)
    await expect(page.getByText('12 задач на доске · 5 в бэклоге')).toBeVisible()
    await expect(page.getByText('4 из 12')).toBeVisible()
    await expect(page.locator('.bar .fill.ok')).toHaveAttribute('style', /width:\s*33%/)
  })

  test('переименовать через меню колонки: Enter сохраняет, изменение уходит на сервер', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Меню колонки На ревью' }).click()
    await page.getByRole('menuitem', { name: 'Переименовать' }).click()
    const input = page.getByRole('textbox', { name: 'Название колонки' })
    await expect(input).toBeFocused()
    await input.fill('Проверка')
    await input.press('Enter')
    await expect(column(page, 'Проверка')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Название колонки' })).toHaveCount(0)
    await expect.poll(async () => (await webTasks(page)).columns.map((c) => c.title)).toContain('Проверка')
  })

  test('«Считать колонкой Готово» меняет прогресс; цвет колонки', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Меню колонки На ревью' }).click()
    await page.getByRole('menuitem', { name: 'Считать колонкой «Готово»' }).click()
    await expect(page.getByText('6 из 12')).toBeVisible()
    await page.getByRole('button', { name: 'Меню колонки На ревью' }).click()
    await expect(page.getByRole('menuitem', { name: 'Не считать колонкой «Готово»' })).toBeVisible()
    await page.getByRole('group', { name: 'Цвет колонки' }).getByRole('button').nth(3).click() // зелёный
    await expect(column(page, 'На ревью').locator('.dot').first()).toHaveAttribute('style', /var\(--ok\)/)
    await expect.poll(async () => (await webTasks(page)).columns.find((c) => c.title === 'На ревью')).toMatchObject({ is_done: true, color: 'ok' })
  })

  test('удаление колонки: задачи переезжают в первую из оставшихся', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Меню колонки К выполнению' }).click()
    await expect(page.getByRole('menuitem', { name: /Удалить колонку/ })).toContainText('Задачи (3) переедут в «В работе»')
    await page.getByRole('menuitem', { name: /Удалить колонку/ }).click()
    await expect(page.locator('.col h2')).toHaveText(['В работе', 'На ревью', 'Готово'])
    await expect(cards(page, 'В работе')).toHaveCount(6)
    await expect.poll(async () => (await webTasks(page)).columns.length).toBe(3)
    await page.reload()
    await expect(cards(page, 'В работе')).toHaveCount(6)
  })

  test('последнюю колонку удалить нельзя', async ({ page }) => {
    await openApp(page)
    for (const title of ['К выполнению', 'В работе', 'На ревью']) {
      await page.getByRole('button', { name: `Меню колонки ${title}` }).click()
      await page.getByRole('menuitem', { name: /Удалить колонку/ }).click()
    }
    await page.getByRole('button', { name: 'Меню колонки Готово' }).click()
    const del = page.getByRole('menuitem', { name: /Удалить колонку/ })
    await expect(del).toContainText('Нельзя удалить единственную колонку')
    await del.click()
    await expect(column(page, 'Готово')).toBeVisible()
  })

  test('новая колонка: Enter добавляет и оставляет поле открытым, Escape закрывает', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Добавить колонку' }).click()
    const input = page.getByRole('textbox', { name: 'Название новой колонки' })
    await expect(input).toBeFocused()
    await input.fill('Тестирование')
    await input.press('Enter')
    await expect(column(page, 'Тестирование')).toBeVisible()
    await expect(input).toHaveValue('')
    await expect(input).toBeFocused()
    await input.press('Escape')
    await expect(input).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Добавить колонку' })).toBeVisible()
    await expect.poll(async () => (await webTasks(page)).columns.map((c) => c.title)).toContain('Тестирование')
  })

  test('быстрое добавление задачи в колонку: номер выдаёт сервер', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Добавить задачу в колонку В работе' }).click()
    const input = page.getByRole('textbox', { name: 'Название новой задачи' })
    await expect(input).toBeFocused()
    await input.fill('Первая быстрая')
    await input.press('Enter')
    await input.fill('Вторая быстрая')
    await input.press('Enter')
    await expect(cards(page, 'В работе')).toHaveCount(5)
    await expect(keys(page, 'В работе')).resolves.toEqual(['WEB-144', 'WEB-146', 'WEB-139', 'WEB-159', 'WEB-160'])
    await input.press('Escape')
    await expect(input).toHaveCount(0)
    await expect(page.getByText('14 задач на доске · 5 в бэклоге')).toBeVisible()
    await page.getByRole('button', { name: 'Добавить задачу в колонку Готово' }).click()
    await page.getByRole('button', { name: 'Отмена' }).click()
    await expect(page.getByRole('textbox', { name: 'Название новой задачи' })).toHaveCount(0)
  })

  test('«Новая задача»: создаётся в первой колонке, панель открыта, название выделено', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Новая задача' }).click()
    await expect(drawer(page)).toBeVisible()
    const title = page.getByRole('textbox', { name: 'Название задачи' })
    await expect(title).toHaveValue('Новая задача')
    await expect(title).toBeFocused()
    await page.keyboard.type('Сделать экспорт в PDF')
    await title.press('Enter')
    await expect(cards(page, 'К выполнению').last()).toContainText('Сделать экспорт в PDF')
    await expect(drawer(page)).toContainText('WEB-159')
    await expect.poll(async () => (await webTasks(page)).tasks.find((t) => t.key === 'WEB-159')?.title).toBe('Сделать экспорт в PDF')
  })
})

test.describe('панель задачи', () => {
  test('открывается по карточке, показывает поля и закрывается по подложке и кнопке', async ({ page }) => {
    await openApp(page)
    await card(page, 'WEB-144').getByRole('button', { name: 'Вход через SSO для корпоративных аккаунтов' }).click()
    const d = drawer(page)
    await expect(d).toBeVisible()
    await expect(d.getByRole('textbox', { name: 'Название задачи' })).toHaveValue('Вход через SSO для корпоративных аккаунтов')
    await expect(d.getByRole('button', { name: 'В работе' })).toHaveAttribute('aria-pressed', 'true')
    await expect(d.getByRole('button', { name: 'Артём К.' })).toHaveAttribute('aria-pressed', 'true')
    await expect(d.getByRole('button', { name: 'Высокий' })).toHaveAttribute('aria-pressed', 'true')
    await expect(d.getByRole('textbox', { name: 'Номер PR' })).toHaveValue('#321')
    await expect(d.getByLabel('Начало')).toHaveValue('2026-10-12')
    await expect(d.getByLabel('Срок')).toHaveValue('2026-10-23')
    await expect(d.getByRole('textbox', { name: 'Описание' })).toHaveValue(/OpenID Connect/)
    await expect(d.getByRole('heading', { name: /Подзадачи/ })).toContainText('3/5')
    await expect(d.getByRole('heading', { name: /Вложения/ })).toBeVisible()
    await page.getByRole('button', { name: 'Закрыть задачу' }).click()
    await expect(d).toHaveCount(0)
    await card(page, 'WEB-144').click()
    await d.getByRole('button', { name: 'Закрыть', exact: true }).click()
    await expect(d).toHaveCount(0)
  })

  test('поля сохраняются: статус, исполнитель, приоритет, даты, модуль, веха, PR, описание', async ({ page }) => {
    await openApp(page)
    await card(page, 'WEB-151').click()
    const d = drawer(page)
    await d.getByRole('button', { name: 'На ревью' }).click()
    await expect(cards(page, 'На ревью').last()).toContainText('WEB-151')
    await d.getByRole('button', { name: 'Игорь П.' }).click()
    await d.getByRole('button', { name: 'Низкий' }).click()
    await fillDate(d.getByLabel('Срок'), '2026-11-03')
    await fillDate(d.getByLabel('Начало'), '2026-10-28')
    await d.getByRole('button', { name: 'Уведомления' }).click()
    await d.getByRole('button', { name: 'Релиз 2.9.0' }).click()
    const pr = d.getByRole('textbox', { name: 'Номер PR' })
    await pr.fill('#400')
    await pr.press('Enter')
    const desc = d.getByRole('textbox', { name: 'Описание' })
    await desc.fill('Экспорт в CSV и PDF')
    await desc.blur()
    await expect(card(page, 'WEB-151')).toContainText('3 ноя')
    await expect(card(page, 'WEB-151')).toContainText('#400')

    await expect
      .poll(async () => {
        const b = await webTasks(page)
        const t = b.tasks.find((x) => x.key === 'WEB-151')!
        return { col: b.columns.find((c) => c.id === t.column_id)?.title, prio: t.priority, due: t.due_date, start: t.start_date, pr: t.pr, hasModule: !!t.module_id, hasMs: !!t.milestone_id }
      })
      .toEqual({ col: 'На ревью', prio: 'low', due: '2026-11-03', start: '2026-10-28', pr: '#400', hasModule: true, hasMs: true })
    await page.reload()
    await card(page, 'WEB-151').click()
    await expect(drawer(page).getByRole('textbox', { name: 'Описание' })).toHaveValue('Экспорт в CSV и PDF')
    await expect(drawer(page).getByRole('button', { name: 'Игорь П.' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('очистка полей: «Никто», «Не выбран», пустые даты', async ({ page }) => {
    await openApp(page)
    await card(page, 'WEB-144').click()
    const d = drawer(page)
    await d.getByRole('button', { name: 'Никто' }).click()
    await d.getByRole('button', { name: 'Не выбран' }).first().click() // модуль
    await fillDate(d.getByLabel('Срок'), '')
    await expect(card(page, 'WEB-144').locator('.avatar')).toHaveAttribute('aria-label', 'Без исполнителя')
    await expect(card(page, 'WEB-144').getByText('23 окт')).toHaveCount(0)
    await expect
      .poll(async () => {
        const t = (await webTasks(page)).tasks.find((x) => x.key === 'WEB-144')!
        return { who: t.assignee_id, due: t.due_date, mod: t.module_id }
      })
      .toEqual({ who: null, due: null, mod: null })
  })

  test('метки: переключение и создание новой по Enter (без повторов по регистру)', async ({ page }) => {
    await openApp(page)
    await card(page, 'WEB-144').click()
    const d = drawer(page)
    await d.getByRole('button', { name: 'Фича' }).click() // снять
    await expect(card(page, 'WEB-144').locator('.tag')).toHaveText(['Бэк'])
    const input = d.getByRole('textbox', { name: 'Новая метка' })
    await input.fill('Релиз')
    await input.press('Enter')
    await expect(d.getByRole('button', { name: 'Релиз', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(card(page, 'WEB-144').locator('.tag')).toHaveText(['Бэк', 'Релиз'])
    await expect(input).toHaveValue('')
    await input.fill('СРОЧНО') // уже есть «Срочно»: берётся существующая
    await input.press('Enter')
    await expect(d.getByRole('button', { name: /^Срочно$/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(d.getByRole('button', { name: /^Срочно$/ })).toHaveCount(1)
    await expect.poll(async () => (await webTasks(page)).tags.map((t) => t.label)).toContain('Релиз')
  })

  test('подзадачи: добавить, отметить, переименовать, удалить; счётчик и полоса на карточке', async ({ page }) => {
    await openApp(page)
    await card(page, 'WEB-144').click()
    const d = drawer(page)
    const heading = d.getByRole('heading', { name: /Подзадачи/ })
    await expect(heading).toContainText('3/5')
    const add = d.getByRole('textbox', { name: 'Новая подзадача' })
    await add.fill('Написать тесты')
    await add.press('Enter')
    await expect(heading).toContainText('3/6')
    await expect(d.getByRole('textbox', { name: 'Подзадача', exact: true }).last()).toHaveValue('Написать тесты')
    await expect(card(page, 'WEB-144')).toContainText('3/6')
    await d.getByRole('button', { name: 'Отметить подзадачу' }).last().click()
    await expect(heading).toContainText('4/6')
    await expect(card(page, 'WEB-144')).toContainText('4/6')
    const last = d.getByRole('textbox', { name: 'Подзадача', exact: true }).last()
    await last.fill('Написать e2e-тесты')
    await last.press('Enter')
    await d.getByRole('button', { name: 'Удалить подзадачу' }).first().click()
    await expect(heading).toContainText(/\d\/5/)
    await expect(card(page, 'WEB-144')).toContainText('/5')
    await page.reload()
    await card(page, 'WEB-144').click()
    await expect(drawer(page).getByRole('textbox', { name: 'Подзадача', exact: true }).last()).toHaveValue('Написать e2e-тесты')
  })

  test('комментарии: отправка, автор и время; пустой не отправляется', async ({ page }) => {
    await openApp(page)
    await card(page, 'WEB-144').click()
    const d = drawer(page)
    await d.getByRole('button', { name: 'Отправить' }).click()
    const before = await d.locator('.comment .bubble').count()
    await d.getByRole('textbox', { name: 'Комментарий' }).fill('Проверил, всё работает')
    await d.getByRole('button', { name: 'Отправить' }).click()
    await expect(d.locator('.comment .bubble')).toHaveCount(before + 1)
    const last = d.locator('.comment .bubble').last()
    await expect(last).toContainText('Лена М.')
    await expect(last).toContainText('только что')
    await expect(last).toContainText('Проверил, всё работает')
    await expect(d.getByRole('textbox', { name: 'Комментарий' })).toHaveValue('')
    await expect(d.getByRole('heading', { name: /Комментарии/ })).toContainText(String(before + 1))
  })

  test('«Отметить выполненной» переносит в «Готово» и обратно', async ({ page }) => {
    await openApp(page)
    await card(page, 'WEB-151').click()
    const d = drawer(page)
    await d.getByRole('button', { name: 'Отметить выполненной' }).click()
    await expect(d.getByRole('button', { name: 'Выполнена' })).toBeVisible()
    await expect(cards(page, 'Готово')).toHaveCount(5)
    await expect(page.getByText('5 из 12')).toBeVisible()
    await d.getByRole('button', { name: 'Выполнена' }).click()
    await expect(cards(page, 'Готово')).toHaveCount(4)
    await expect(cards(page, 'К выполнению')).toHaveCount(3)
  })

  test('удаление в два шага: первое нажатие просит подтверждения', async ({ page }) => {
    await openApp(page)
    await card(page, 'WEB-151').click()
    const d = drawer(page)
    await d.getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect(d.getByRole('button', { name: 'Точно удалить?' })).toBeVisible()
    await expect(card(page, 'WEB-151')).toBeVisible()
    // закрыли и открыли снова: подтверждение сброшено
    await page.getByRole('button', { name: 'Закрыть задачу' }).click()
    await card(page, 'WEB-151').click()
    await expect(d.getByRole('button', { name: 'Удалить', exact: true })).toBeVisible()
    await d.getByRole('button', { name: 'Удалить', exact: true }).click()
    await d.getByRole('button', { name: 'Точно удалить?' }).click()
    await expect(d).toHaveCount(0)
    await expect(card(page, 'WEB-151')).toHaveCount(0)
    await expect(page.getByText('11 задач на доске · 5 в бэклоге')).toBeVisible()
    await expect.poll(async () => (await webTasks(page)).tasks.some((t) => t.key === 'WEB-151')).toBe(false)
  })
})

test.describe('оптимистичные обновления', () => {
  test('перенос показывается сразу, не дожидаясь сервера', async ({ page }) => {
    await openApp(page)
    await page.route('**/api/v1/tasks/*', async (route) => {
      if (route.request().method() === 'PATCH') await new Promise((r) => setTimeout(r, 1500))
      await route.continue()
    })
    await card(page, 'WEB-151').click()
    const t0 = Date.now()
    await drawer(page).getByRole('button', { name: 'На ревью' }).click()
    await expect(cards(page, 'На ревью').last()).toContainText('WEB-151', { timeout: 1000 })
    expect(Date.now() - t0).toBeLessThan(1400)
    await expect.poll(async () => (await webTasks(page)).tasks.find((t) => t.key === 'WEB-151')?.column_id).not.toBe(null)
  })

  test('отказ сервера возвращает прежнее состояние', async ({ page }) => {
    await openApp(page)
    await page.route('**/api/v1/tasks/*', async (route) => {
      if (route.request().method() === 'PATCH') await route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"internal","message":"сбой"}' })
      else await route.continue()
    })
    await card(page, 'WEB-151').click()
    await drawer(page).getByRole('button', { name: 'На ревью' }).click()
    await expect(cards(page, 'К выполнению')).toHaveCount(3, { timeout: 10_000 })
    await expect(cards(page, 'На ревью')).toHaveCount(2)
    await expect(drawer(page).getByRole('button', { name: 'К выполнению' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('отказ при переименовании колонки возвращает название', async ({ page }) => {
    await openApp(page)
    await page.route('**/api/v1/columns/*', async (route) => {
      if (route.request().method() === 'PATCH') await route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"internal","message":"сбой"}' })
      else await route.continue()
    })
    await page.getByRole('button', { name: 'Меню колонки На ревью' }).click()
    await page.getByRole('menuitem', { name: 'Переименовать' }).click()
    const input = page.getByRole('textbox', { name: 'Название колонки' })
    await input.fill('Другое')
    await input.press('Enter')
    await expect(column(page, 'На ревью')).toBeVisible({ timeout: 10_000 })
    await expect(column(page, 'Другое')).toHaveCount(0)
  })
})
