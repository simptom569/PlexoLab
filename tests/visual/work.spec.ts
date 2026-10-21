import { expect, test, type Page } from '@playwright/test'
import { compareToReference, type Rect } from './compare'
import { openApp, resetData } from './fixtures'
import { fillDate, textRects } from './helpers'
import { MAX_DIFF_RATIO } from './tolerance'

// Всё правее бокового меню: меню сверяется отдельно (sidebar.spec.ts)
const MAIN: Rect = { x: 233, y: 0, width: 1207, height: 900 }

/** Плавающую копию под указателем в эталонах нет (её рисует браузер), поэтому на снимке прячем */
const HIDE_OVERLAY = '.drag-overlay{visibility:hidden}'
/** В эталоне подсвечена строка, над которой браузер оставил указатель до начала переноса; у нас подсветка идёт за указателем */
const NO_ROW_HOVER = '.brow:hover{background:transparent !important}.brow:hover .row-title{color:var(--ink) !important}'

type Screen = { file: string; page: 'backlog' | 'modules' | 'releases'; heading: string; ready: (page: Page) => Promise<void> }

const SCREENS: Screen[] = [
  { file: '09-backlog', page: 'backlog', heading: 'Бэклог', ready: (p) => expect(p.locator('[data-row-id]')).toHaveCount(5) },
  { file: '10-modules', page: 'modules', heading: 'Модули', ready: (p) => expect(p.locator('.cards-grid .panel')).toHaveCount(4) },
  { file: '11-releases', page: 'releases', heading: 'Релизы и вехи', ready: (p) => expect(p.locator('.panel').first()).toBeVisible() },
]

async function center(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox()
  expect(box, selector).not.toBeNull()
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2, box: box! }
}

/** Берёт элемент мышью и плавно ведёт к точке (с остановкой на ходу, чтобы сработало расстояние активации) */
async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 3 })
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.waitForTimeout(100)
}

async function compare(page: Page, file: string, name: string, extraIgnore: Rect[] = []) {
  const actual = await page.screenshot({ clip: MAIN })
  const text = await textRects(page, MAIN)
  const { diffPixels, total, diffRatio } = compareToReference({
    actual,
    referenceFile: file,
    region: MAIN,
    ignore: [...text, ...extraIgnore],
    name,
  })
  console.log(`  ${name}: отличается ${diffPixels} из ${total} (${(diffRatio * 100).toFixed(3)}%), строк текста исключено: ${text.length}`)
  expect(diffRatio).toBeLessThan(MAX_DIFF_RATIO)
}

// ----- Общее: данные сервера для проверок -----

const SERVER = 'http://127.0.0.1:8099'

async function token(page: Page): Promise<string> {
  const res = await page.request.post(`${SERVER}/api/v1/auth/login`, { data: { email: 'lena@example.com', password: 'dev' } })
  return ((await res.json()) as { access_token: string }).access_token
}

async function api<T>(page: Page, path: string): Promise<T> {
  const res = await page.request.get(`${SERVER}/api/v1${path}`, { headers: { Authorization: `Bearer ${await token(page)}` } })
  expect(res.ok(), path).toBeTruthy()
  return (await res.json()) as T
}

type Board = {
  project: { id: string }
  columns: Array<{ id: string; title: string; position: number }>
  tasks: Array<{ id: string; key: string; column_id: string | null; position: number; module_id: string | null; milestone_id: string | null; title: string }>
  modules: Array<{ id: string; title: string; status: string; lead_id: string | null; note: string; date_from: string | null; tasks_total: number; tasks_done: number }>
  milestones: Array<{ id: string; title: string; due_date: string; tasks_total: number; tasks_done: number }>
}
type Release = { id: string; version: string; status: string; notes: string; release_date: string; items: Array<{ title: string; done: boolean }> }

async function webBoard(page: Page): Promise<Board> {
  const projects = await api<Array<{ id: string; name: string }>>(page, '/projects')
  return api<Board>(page, `/projects/${projects.find((p) => p.name === 'Web-приложение')!.id}/board`)
}

async function webReleases(page: Page): Promise<Release[]> {
  const board = await webBoard(page)
  return api<Release[]>(page, `/projects/${board.project.id}/releases`)
}

const backlogKeys = (b: Board) =>
  b.tasks.filter((t) => t.column_id === null).sort((x, y) => x.position - y.position).map((t) => t.key)

test.beforeEach(() => resetData())

// ----- Эталоны 09–11 и 22 -----

for (const theme of ['light', 'dark'] as const) {
  for (const screen of SCREENS) {
    test(`${screen.file}: ${theme}`, async ({ page }) => {
      await openApp(page, { theme, settings: { page: screen.page } })
      await expect(page.getByRole('heading', { name: screen.heading, level: 1 })).toBeVisible()
      await screen.ready(page)
      await page.mouse.move(1000, 880)
      await page.waitForTimeout(150)
      await compare(page, `${screen.file}-${theme}.png`, `${screen.file}-${theme}`)
    })
  }

  test(`22: строка WEB-157 над строкой WEB-155 (${theme})`, async ({ page }) => {
    await openApp(page, { theme, settings: { page: 'backlog' } })
    await expect(page.locator('[data-row-id]')).toHaveCount(5)
    const from = await center(page, '[data-row-id]:has-text("WEB-157") .grip')
    const target = await center(page, '[data-row-id]:has-text("WEB-155")')
    await dragTo(page, from, { x: target.x, y: target.box.y + 12 })
    await page.addStyleTag({ content: HIDE_OVERLAY + NO_ROW_HOVER })
    // строка под указателем в эталоне подсвечена по-другому (см. NO_ROW_HOVER): её фон не сравниваем
    const hovered = await page.locator('[data-row-id]:has-text("WEB-156")').boundingBox()
    const mask: Rect[] = [{ x: Math.round(hovered!.x - MAIN.x), y: Math.round(hovered!.y), width: Math.round(hovered!.width), height: Math.round(hovered!.height) }]
    await compare(page, `22-drag-backlog-${theme}.png`, `22-drag-backlog-${theme}`, mask)
    await page.keyboard.press('Escape')
    await page.mouse.up()
  })
}

// ----- Бэклог -----

test.describe('бэклог', () => {
  const keys = (page: Page) => page.locator('[data-row-id] .mono')

  test('перетаскивание меняет порядок и он сохраняется после перезагрузки', async ({ page }) => {
    await openApp(page, { settings: { page: 'backlog' } })
    await expect(keys(page)).toHaveText(['WEB-154', 'WEB-155', 'WEB-156', 'WEB-157', 'WEB-158'])
    const from = await center(page, '[data-row-id]:has-text("WEB-157") .grip')
    const target = await center(page, '[data-row-id]:has-text("WEB-154")')
    await dragTo(page, from, { x: target.x, y: target.box.y + 10 })
    await expect(page.locator('.brow-ph')).toHaveCount(1)
    await page.mouse.up()
    await expect(keys(page)).toHaveText(['WEB-157', 'WEB-154', 'WEB-155', 'WEB-156', 'WEB-158'])
    await expect(page.locator('.brow-ph')).toHaveCount(0)
    await expect.poll(async () => backlogKeys(await webBoard(page))).toEqual(['WEB-157', 'WEB-154', 'WEB-155', 'WEB-156', 'WEB-158'])
    await page.reload()
    await expect(keys(page)).toHaveText(['WEB-157', 'WEB-154', 'WEB-155', 'WEB-156', 'WEB-158'])
  })

  test('нижняя половина последней строки: перенос в конец списка', async ({ page }) => {
    await openApp(page, { settings: { page: 'backlog' } })
    const from = await center(page, '[data-row-id]:has-text("WEB-154") .grip')
    const last = await center(page, '[data-row-id]:has-text("WEB-158")')
    // верхняя половина последней строки: заглушка встаёт перед ней и сдвигает её вниз
    await dragTo(page, from, { x: last.x, y: last.box.y + 8 })
    await expect(page.locator('.brow-ph')).toHaveCount(1)
    // после сдвига ведём указатель к нижней половине последней строки: заглушка уходит под неё
    const shifted = await center(page, '[data-row-id]:has-text("WEB-158")')
    await page.mouse.move(shifted.x, shifted.box.y + shifted.box.height - 8, { steps: 6 })
    await page.waitForTimeout(100)
    await expect(page.locator('.sheet-scroll > :last-child')).toHaveClass(/brow-ph/)
    await page.mouse.up()
    await expect(keys(page)).toHaveText(['WEB-155', 'WEB-156', 'WEB-157', 'WEB-158', 'WEB-154'])
    await expect.poll(async () => backlogKeys(await webBoard(page))).toEqual(['WEB-155', 'WEB-156', 'WEB-157', 'WEB-158', 'WEB-154'])
  })

  test('возврат строки на то же место ничего не меняет', async ({ page }) => {
    await openApp(page, { settings: { page: 'backlog' } })
    const requests: string[] = []
    page.on('request', (r) => r.method() === 'PATCH' && requests.push(r.url()))
    const from = await center(page, '[data-row-id]:has-text("WEB-155") .grip')
    const target = await center(page, '[data-row-id]:has-text("WEB-156")')
    // верхняя половина следующей строки: место прямо перед WEB-156, то есть то же, где стоит WEB-155
    await dragTo(page, from, { x: target.x, y: target.box.y + 10 })
    await expect(page.locator('.brow-ph')).toHaveCount(0)
    await page.mouse.up()
    await page.waitForTimeout(300)
    expect(requests).toEqual([])
    await expect(keys(page)).toHaveText(['WEB-154', 'WEB-155', 'WEB-156', 'WEB-157', 'WEB-158'])
  })

  test('отпустили не над списком: ничего не происходит', async ({ page }) => {
    await openApp(page, { settings: { page: 'backlog' } })
    const requests: string[] = []
    page.on('request', (r) => r.method() === 'PATCH' && requests.push(r.url()))
    const from = await center(page, '[data-row-id]:has-text("WEB-154") .grip')
    await dragTo(page, from, { x: 800, y: 70 }) // заголовок страницы
    await page.mouse.up()
    await page.waitForTimeout(300)
    expect(requests).toEqual([])
    await expect(keys(page)).toHaveText(['WEB-154', 'WEB-155', 'WEB-156', 'WEB-157', 'WEB-158'])
  })

  test('«На доску» кладёт задачу в конец первой колонки, счётчик в меню уменьшается', async ({ page }) => {
    await openApp(page, { settings: { page: 'backlog' } })
    const count = page.locator('.side .count')
    await expect(count).toHaveText('5')
    await page.locator('[data-row-id]:has-text("WEB-155")').getByRole('button', { name: 'На доску' }).click()
    await expect(keys(page)).toHaveText(['WEB-154', 'WEB-156', 'WEB-157', 'WEB-158'])
    await expect(count).toHaveText('4')
    await expect
      .poll(async () => {
        const b = await webBoard(page)
        const first = b.columns.sort((x, y) => x.position - y.position)[0]!.id
        return b.tasks.filter((t) => t.column_id === first).sort((x, y) => x.position - y.position).map((t) => t.key).at(-1)
      })
      .toBe('WEB-155')
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Доска' }).click()
    await expect(page.locator('[data-col-id]').first().locator('[data-card-id]').last()).toContainText('WEB-155')
  })

  test('быстрый ввод: Enter добавляет задачу в бэклог, пустая строка игнорируется', async ({ page }) => {
    await openApp(page, { settings: { page: 'backlog' } })
    const input = page.getByLabel('Новая задача в бэклог')
    await input.fill('   ')
    await input.press('Enter')
    await expect(keys(page)).toHaveCount(5)

    await input.fill('  Починить экспорт  ')
    await input.press('Enter')
    await expect(input).toHaveValue('')
    await expect(page.locator('[data-row-id]').last()).toContainText('Починить экспорт')
    await expect(keys(page).last()).toHaveText('WEB-159')
    await expect(page.locator('.side .count')).toHaveText('6')

    await input.fill('Через кнопку')
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()
    await expect(keys(page)).toHaveCount(7)
    await expect.poll(async () => backlogKeys(await webBoard(page))).toHaveLength(7)
  })

  test('клик по названию открывает панель задачи', async ({ page }) => {
    await openApp(page, { settings: { page: 'backlog' } })
    await page.getByRole('button', { name: 'Фильтр по дате в журнале действий' }).click()
    await expect(page.locator('.drawer')).toBeVisible()
    await expect(page.locator('.drawer')).toContainText('WEB-154')
  })

  test('пустой бэклог показывает подсказку', async ({ page }) => {
    await openApp(page, { settings: { page: 'backlog' } })
    for (let i = 0; i < 5; i++) {
      await page.locator('[data-row-id]').first().getByRole('button', { name: 'На доску' }).click()
    }
    await expect(page.getByText('Бэклог пуст. Все задачи уже на доске')).toBeVisible()
    await expect(page.locator('.side .count')).toHaveText('0')
  })
})

// ----- Модули -----

test.describe('модули', () => {
  const card = (page: Page, title: string) => page.locator('.cards-grid .panel').filter({ has: page.locator(`input[aria-label="Название модуля"][value="${title}"]`) })

  test('статус переключается по кругу и сохраняется', async ({ page }) => {
    await openApp(page, { settings: { page: 'modules' } })
    const pill = card(page, 'Надёжность').locator('.pill-btn')
    await expect(pill).toHaveText('Запланирован')
    await expect(pill).toHaveClass(/\bplan\b/)
    await pill.click()
    await expect(pill).toHaveText('В работе')
    await expect(pill).toHaveClass(/\bprogress\b/)
    await pill.click()
    await expect(pill).toHaveText('Завершён')
    await expect(pill).toHaveClass(/\bdone\b/)
    await expect.poll(async () => (await webBoard(page)).modules.find((m) => m.title === 'Надёжность')?.status).toBe('done')
    await pill.click()
    await expect(pill).toHaveText('Запланирован')
    await page.reload()
    await expect(card(page, 'Надёжность').locator('.pill-btn')).toHaveText('Запланирован')
  })

  test('ответственный выбирается из раскрывающегося списка участников проекта', async ({ page }) => {
    await openApp(page, { settings: { page: 'modules' } })
    // у кнопки есть текст («Артём К.»), поэтому «Сменить ответственного» — это подсказка (title), а не имя для getByRole
    const lead = card(page, 'SSO').locator('button[title="Сменить ответственного"]')
    await expect(lead).toContainText('Артём К.')
    await expect(lead).toHaveAttribute('aria-expanded', 'false')
    await lead.click()
    const menu = page.getByRole('menu', { name: 'Ответственный' })
    await expect(lead).toHaveAttribute('aria-expanded', 'true')
    // в тексте пункта первая буква — аватар, поэтому имена берём без неё
    const names = async () => (await menu.getByRole('menuitemradio').allTextContents()).map((t) => t.slice(1))
    expect(await names()).toEqual(['Не назначен', 'Лена М.', 'Артём К.', 'Даниил С.', 'Соня В.', 'Игорь П.'])
    await expect(menu.getByRole('menuitemradio', { name: 'Артём К.' })).toHaveAttribute('aria-checked', 'true')
    await menu.getByRole('menuitemradio', { name: 'Соня В.' }).click()
    await expect(menu).toHaveCount(0)
    await expect(lead).toContainText('Соня В.')
    await expect(lead).toBeFocused()
    const sonya = (await api<Array<{ id: string; name: string }>>(page, '/users')).find((u) => u.name === 'Соня В.')!
    await expect.poll(async () => (await webBoard(page)).modules.find((m) => m.title === 'SSO')?.lead_id).toBe(sonya.id)
    await page.reload()
    await expect(card(page, 'SSO').locator('button[title="Сменить ответственного"]')).toContainText('Соня В.')
  })

  test('список ответственного: стрелки и Enter, Esc закрывает без выбора, клик мимо тоже, «Не назначен» снимает', async ({ page }) => {
    await openApp(page, { settings: { page: 'modules' } })
    const lead = card(page, 'SSO').locator('button[title="Сменить ответственного"]')
    const menu = page.getByRole('menu', { name: 'Ответственный' })

    await lead.click()
    await expect(menu.getByRole('menuitemradio', { name: 'Артём К.' })).toBeFocused() // фокус сразу на выбранном
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(lead).toBeFocused()
    await expect(lead).toContainText('Артём К.')

    await lead.click()
    await page.mouse.click(700, 880) // мимо списка
    await expect(menu).toHaveCount(0)
    await expect(lead).toContainText('Артём К.')

    await lead.click()
    await page.keyboard.press('ArrowDown')
    await expect(menu.getByRole('menuitemradio', { name: 'Даниил С.' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(lead).toContainText('Даниил С.')
    await expect.poll(async () => (await webBoard(page)).modules.find((m) => m.title === 'SSO')?.lead_id).toBe(
      (await api<Array<{ id: string; name: string }>>(page, '/users')).find((u) => u.name === 'Даниил С.')!.id,
    )

    await lead.click()
    await menu.getByRole('menuitemradio', { name: 'Не назначен' }).click()
    await expect(lead).toContainText('Не назначен')
    await expect.poll(async () => (await webBoard(page)).modules.find((m) => m.title === 'SSO')?.lead_id).toBeNull()
  })

  test('название и описание сохраняются, когда поле отпускают', async ({ page }) => {
    await openApp(page, { settings: { page: 'modules' } })
    // «Уведомления» — вторая карточка; ищем её по месту, а не по значению поля, которое мы же и меняем
    const panel = page.locator('.cards-grid .panel').nth(1)
    const title = panel.getByLabel('Название модуля')
    await expect(title).toHaveValue('Уведомления')
    await title.fill('Уведомления и рассылки')
    await title.press('Enter')
    await panel.getByLabel('Описание модуля').fill('')
    await panel.getByLabel('Описание модуля').press('Tab')
    await expect.poll(async () => (await webBoard(page)).modules.map((m) => [m.title, m.note])).toContainEqual(['Уведомления и рассылки', ''])
    // пустое название не принимается: возвращается прежнее
    await title.fill('   ')
    await title.press('Tab')
    await expect(title).toHaveValue('Уведомления и рассылки')
    await page.reload()
    await expect(page.locator('.cards-grid .panel').nth(1).getByLabel('Название модуля')).toHaveValue('Уведомления и рассылки')
  })

  test('даты модуля меняются и очищаются', async ({ page }) => {
    await openApp(page, { settings: { page: 'modules' } })
    const dateFrom = async () => (await webBoard(page)).modules.find((m) => m.title === 'Надёжность')?.date_from
    const from = card(page, 'Надёжность').locator('input[type=date]').first()
    await expect(from).toHaveValue('2026-11-02')
    await fillDate(from, '2026-11-05')
    await expect.poll(dateFrom).toBe('2026-11-05')
    await fillDate(from, '')
    await expect.poll(dateFrom).toBeNull()
    await page.reload()
    await expect(card(page, 'Надёжность').locator('input[type=date]').first()).toHaveValue('')
  })

  test('новый модуль: добавление по Enter, ответственный — автор, пустое название игнорируется', async ({ page }) => {
    await openApp(page, { settings: { page: 'modules' } })
    const input = page.getByLabel('Название нового модуля')
    await input.press('Enter')
    await expect(page.locator('.cards-grid .panel')).toHaveCount(4)
    await input.fill('  Платежи  ')
    await input.press('Enter')
    await expect(input).toHaveValue('')
    const created = card(page, 'Платежи')
    await expect(created).toBeVisible()
    await expect(page.locator('.cards-grid .panel').last().getByLabel('Название модуля')).toHaveValue('Платежи')
    await expect(created.locator('.pill-btn')).toHaveText('Запланирован')
    await expect(created.locator('button[title="Сменить ответственного"]')).toContainText('Лена М.')
    await expect(created).toContainText('0 из 0 задач готово')
    await expect(created.locator('.drop-hint')).toHaveText('Задач пока нет. Модуль выбирается в панели задачи')
    await expect.poll(async () => (await webBoard(page)).modules.map((m) => m.title)).toContain('Платежи')
  })

  test('удаление просит подтверждения вторым нажатием, задачи остаются без модуля', async ({ page }) => {
    await openApp(page, { settings: { page: 'modules' } })
    const c = card(page, 'Тёмная тема')
    await c.getByRole('button', { name: 'Удалить' }).click()
    await expect(c.getByRole('button', { name: 'Точно удалить?' })).toBeVisible()
    // клик по другому удалению переносит вопрос на него
    await card(page, 'SSO').getByRole('button', { name: 'Удалить' }).click()
    await expect(c.getByRole('button', { name: 'Удалить' })).toBeVisible()
    await expect(card(page, 'SSO').getByRole('button', { name: 'Точно удалить?' })).toBeVisible()
    await c.getByRole('button', { name: 'Удалить' }).click()
    await c.getByRole('button', { name: 'Точно удалить?' }).click()
    await expect(page.locator('.cards-grid .panel')).toHaveCount(3)
    await expect.poll(async () => (await webBoard(page)).modules.map((m) => m.title)).not.toContain('Тёмная тема')
    const board = await webBoard(page)
    expect(board.tasks.find((t) => t.key === 'WEB-141')?.module_id).toBeNull()
  })

  test('«Показать на доске» включает фильтр по модулю и открывает доску', async ({ page }) => {
    await openApp(page, { settings: { page: 'modules' } })
    await card(page, 'SSO').getByRole('button', { name: 'Показать на доске' }).click()
    await expect(page.getByRole('heading', { name: 'Доска', level: 1 })).toBeVisible()
    await expect(page.locator('.filter-chip')).toHaveText(/SSO/)
    await expect(page.locator('[data-card-id]')).toHaveCount(1)
    await expect(page.locator('[data-card-id]')).toContainText('WEB-144')
  })

  test('прогресс модуля пересчитывается, когда задачу переводят в «Готово»', async ({ page }) => {
    await openApp(page, { settings: { page: 'modules' } })
    await expect(card(page, 'SSO')).toContainText('0 из 2 задач готово')
    await expect(card(page, 'SSO')).toContainText('0%')
    await card(page, 'SSO').getByRole('button', { name: 'Вход через SSO для корпоративных аккаунтов' }).click()
    await page.locator('.drawer').getByRole('button', { name: 'Готово', exact: true }).click()
    await page.locator('.drawer').getByRole('button', { name: 'Закрыть' }).first().click()
    await expect(card(page, 'SSO')).toContainText('1 из 2 задач готово')
    await expect(card(page, 'SSO')).toContainText('50%')
    await expect.poll(async () => (await webBoard(page)).modules.find((m) => m.title === 'SSO')?.tasks_done).toBe(1)
  })

  test('в карточке пять задач, остальные — «и ещё N»', async ({ page }) => {
    await openApp(page, { settings: { page: 'modules' } })
    const board = await webBoard(page)
    const module = board.modules.find((m) => m.title === 'Надёжность')!
    // в «Надёжности» уже одна задача; добавляем пять в бэклог и привязываем к модулю
    const headers = { Authorization: `Bearer ${await token(page)}` }
    for (let i = 0; i < 5; i++) {
      const created = await page.request.post(`${SERVER}/api/v1/projects/${board.project.id}/tasks`, { headers, data: { title: `Доп ${i}` } })
      const task = (await created.json()) as { id: string }
      await page.request.patch(`${SERVER}/api/v1/tasks/${task.id}`, { headers, data: { module_id: module.id } })
    }
    await page.reload()
    const c = card(page, 'Надёжность')
    await expect(c.locator('.mini-task')).toHaveCount(5)
    await expect(c).toContainText('и ещё 1')
    await expect(c).toContainText('0 из 6 задач готово')
  })
})

// ----- Релизы и вехи -----

test.describe('вехи', () => {
  const rows = (page: Page) => page.locator('.ms-row').filter({ has: page.getByLabel('Название вехи') })

  test('подписи срока и прогресса считаются от сегодняшней даты', async ({ page }) => {
    await openApp(page, { settings: { page: 'releases' } })
    await expect(rows(page)).toHaveCount(3)
    await expect(rows(page).nth(0)).toContainText('через 5 дн. · 1 из 3 задач')
    await expect(rows(page).nth(0)).toContainText('33%')
    await expect(rows(page).nth(1)).toContainText('через 12 дн. · 0 из 0 задач')
    await expect(rows(page).nth(2)).toContainText('через 33 дн.')
  })

  test('добавление: название и дата, без даты — через 14 дней, пустое название игнорируется', async ({ page }) => {
    await openApp(page, { settings: { page: 'releases' } })
    const title = page.getByLabel('Название новой вехи')
    await page.getByRole('button', { name: 'Добавить веху' }).click()
    await expect(rows(page)).toHaveCount(3)

    await title.fill('Демо клиенту')
    await page.getByRole('button', { name: 'Добавить веху' }).click()
    await expect(title).toHaveValue('')
    await expect(rows(page)).toHaveCount(4)
    // 18 октября + 14 дней = 1 ноября: попадает между «Бетой» (30 окт) и «Релизом 2.9.0» (20 ноя)
    await expect(rows(page).nth(2).getByLabel('Название вехи')).toHaveValue('Демо клиенту')
    await expect(rows(page).nth(2).getByLabel('Дата вехи')).toHaveValue('2026-11-01')

    await title.fill('С датой')
    await fillDate(page.getByLabel('Дата новой вехи'), '2026-10-19')
    await title.press('Enter')
    await expect(rows(page).nth(0).getByLabel('Название вехи')).toHaveValue('С датой')
    await expect(rows(page).nth(0)).toContainText('через 1 дн.')
    await expect.poll(async () => (await webBoard(page)).milestones.map((m) => m.title)).toEqual(['С датой', 'Релиз 2.8.0', 'Бета для сотрудников', 'Демо клиенту', 'Релиз 2.9.0'])
  })

  test('дата и название меняются; просроченная веха подписана красным', async ({ page }) => {
    await openApp(page, { settings: { page: 'releases' } })
    const first = rows(page).nth(0)
    await fillDate(first.getByLabel('Дата вехи'), '2026-10-15')
    await expect(rows(page).nth(0)).toContainText('просрочена на 3 дн.')
    await expect(rows(page).nth(0).locator('.late')).toHaveText('просрочена на 3 дн.')
    await first.getByLabel('Название вехи').fill('Релиз 2.8.1')
    await first.getByLabel('Название вехи').press('Enter')
    await expect.poll(async () => (await webBoard(page)).milestones.map((m) => [m.title, m.due_date])).toContainEqual(['Релиз 2.8.1', '2026-10-15'])
  })

  test('удаление просит подтверждения, задачи остаются без вехи', async ({ page }) => {
    await openApp(page, { settings: { page: 'releases' } })
    const { tasks: tasksBefore, milestones } = await webBoard(page)
    const milestone = milestones.find((m) => m.title === 'Релиз 2.8.0')!
    const row = rows(page).nth(0)
    await row.getByRole('button', { name: 'Удалить' }).click()
    await expect(row.getByRole('button', { name: 'Точно удалить?' })).toBeVisible()
    await row.getByRole('button', { name: 'Точно удалить?' }).click()
    await expect(rows(page)).toHaveCount(2)
    await expect.poll(async () => (await webBoard(page)).milestones.map((m) => m.title)).not.toContain('Релиз 2.8.0')
    // задачи вехи остались, просто без вехи
    const after = await webBoard(page)
    expect(after.tasks).toHaveLength(tasksBefore.length)
    expect(tasksBefore.filter((t) => t.milestone_id === milestone.id).length).toBeGreaterThan(0)
    for (const t of tasksBefore.filter((t) => t.milestone_id === milestone.id)) {
      expect(after.tasks.find((x) => x.id === t.id)?.milestone_id).toBeNull()
    }
  })

  test('прогресс вехи пересчитывается, когда задачу переводят в «Готово» на доске', async ({ page }) => {
    await openApp(page)
    const board = await webBoard(page)
    const milestone = board.milestones.find((m) => m.title === 'Релиз 2.8.0')!
    const done = board.columns.find((c) => c.title === 'Готово')!
    const open = board.tasks.find((t) => t.milestone_id === milestone.id && t.column_id !== done.id && t.column_id !== null)
    expect(open, 'у «Релиза 2.8.0» есть задача вне «Готово»').toBeDefined()

    await page.locator(`[data-card-id]:has-text("${open!.key}")`).click()
    await page.locator('.drawer').getByRole('button', { name: 'Готово', exact: true }).click()
    await page.locator('.drawer').getByRole('button', { name: 'Закрыть' }).first().click()
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Релизы и вехи' }).click()
    await expect(rows(page).nth(0)).toContainText('2 из 3 задач')
    await expect(rows(page).nth(0)).toContainText('67%')
    await expect.poll(async () => (await webBoard(page)).milestones.find((m) => m.id === milestone.id)?.tasks_done).toBe(2)
  })
})

test.describe('релизы', () => {
  const card = (page: Page, version: string) => page.locator('.panel').filter({ has: page.locator(`input[aria-label="Версия"][value="${version}"]`) })

  test('новый релиз: дата через 21 день, четыре стандартных шага, встаёт по дате', async ({ page }) => {
    await openApp(page, { settings: { page: 'releases' } })
    const input = page.getByLabel('Версия нового релиза')
    await input.press('Enter')
    // у «Web-приложения» три релиза: 2.9.0, 2.8.0, 2.7.2
    await expect(page.locator('input[aria-label="Версия"]')).toHaveCount(3)

    await input.fill('3.0.0')
    await page.getByRole('button', { name: 'Новый релиз' }).click()
    await expect(input).toHaveValue('')
    const created = card(page, '3.0.0')
    await expect(created).toBeVisible()
    await expect(created.getByLabel('Дата релиза')).toHaveValue('2026-11-08')
    await expect(created.locator('.sub-input:not([placeholder])')).toHaveCount(4)
    await expect(created.locator('.sub-input:not([placeholder])').first()).toHaveValue('Заморозка кода')
    await expect(created).toContainText('Чек-лист выкатки: 0 из 4')
    await expect(created.locator('.pill-btn')).toHaveText('Запланирован')
    // 2.9.0 (20 ноября) выше, 3.0.0 (8 ноября) вторая, 2.8.0 (23 октября) и 2.7.2 ниже
    await expect(page.locator('input[aria-label="Версия"]')).toHaveCount(4)
    await expect(page.locator('input[aria-label="Версия"]').nth(1)).toHaveValue('3.0.0')
    await expect.poll(async () => (await webReleases(page)).map((r) => r.version)).toEqual(['2.9.0', '3.0.0', '2.8.0', '2.7.2'])
  })

  test('статус переключается по кругу: Запланирован, Готовится, Выпущен', async ({ page }) => {
    await openApp(page, { settings: { page: 'releases' } })
    const pill = card(page, '2.9.0').locator('.pill-btn')
    await expect(pill).toHaveText('Запланирован')
    await pill.click()
    await expect(pill).toHaveText('Готовится')
    await pill.click()
    await expect(pill).toHaveText('Выпущен')
    await expect(pill).toHaveClass(/\bdone\b/)
    await expect.poll(async () => (await webReleases(page)).find((r) => r.version === '2.9.0')?.status).toBe('done')
    await pill.click()
    await expect(pill).toHaveText('Запланирован')
  })

  test('чек-лист: отметка, переименование, удаление, добавление по Enter', async ({ page }) => {
    await openApp(page, { settings: { page: 'releases' } })
    const c = card(page, '2.9.0')
    const steps = c.locator('.sub-input:not([placeholder])')
    await expect(steps).toHaveCount(4)
    await expect(c).toContainText('Чек-лист выкатки: 0 из 4')

    await c.getByRole('button', { name: 'Отметить шаг' }).nth(1).click()
    await expect(c).toContainText('Чек-лист выкатки: 1 из 4')
    await expect(c).toContainText('25%')
    await expect(steps.nth(1)).toHaveClass(/\bdone\b/)
    await expect.poll(async () => (await webReleases(page)).find((r) => r.version === '2.9.0')?.items.map((i) => i.done)).toEqual([false, true, false, false])

    await steps.nth(2).fill('Обновить документацию')
    await steps.nth(2).press('Enter')
    await expect.poll(async () => (await webReleases(page)).find((r) => r.version === '2.9.0')?.items[2]?.title).toBe('Обновить документацию')

    const draft = c.getByLabel('Новый шаг выкатки')
    await draft.fill('Сообщить клиентам')
    await draft.press('Enter')
    await expect(draft).toHaveValue('')
    await expect(steps).toHaveCount(5)
    await expect(steps.last()).toHaveValue('Сообщить клиентам')
    await expect(c).toContainText('Чек-лист выкатки: 1 из 5')

    await c.getByRole('button', { name: 'Удалить шаг' }).first().click()
    await expect(steps).toHaveCount(4)
    await expect.poll(async () => (await webReleases(page)).find((r) => r.version === '2.9.0')?.items.map((i) => i.title)).toEqual(['Регрессионные тесты', 'Обновить документацию', 'Выкатка на прод', 'Сообщить клиентам'])
    await page.reload()
    await expect(card(page, '2.9.0').locator('.sub-input:not([placeholder])')).toHaveCount(4)
  })

  test('когда все шаги отмечены, полоска зелёная', async ({ page }) => {
    await openApp(page, { settings: { page: 'releases' } })
    const c = card(page, '2.9.0')
    for (let i = 0; i < 4; i++) await c.getByRole('button', { name: 'Отметить шаг' }).nth(i).click()
    await expect(c).toContainText('Чек-лист выкатки: 4 из 4')
    await expect(c.locator('.fill.ok')).toHaveCount(1)
    await expect(c).toContainText('100%')
  })

  test('версия, дата и список изменений сохраняются', async ({ page }) => {
    await openApp(page, { settings: { page: 'releases' } })
    // карточку ищем по месту (самая новая сверху), потому что версию мы же и меняем
    const c = page.locator('.panel').filter({ has: page.getByLabel('Версия', { exact: true }) }).first()
    await expect(c.getByLabel('Версия', { exact: true })).toHaveValue('2.9.0')
    await c.getByLabel('Список изменений').fill('• Тёмная тема\n• SSO')
    await fillDate(c.getByLabel('Дата релиза'), '2026-12-01')
    await c.getByLabel('Версия', { exact: true }).fill('2.9.1')
    await c.getByLabel('Версия', { exact: true }).press('Enter')
    await expect.poll(async () => (await webReleases(page)).map((r) => [r.version, r.release_date, r.notes])).toContainEqual(['2.9.1', '2026-12-01', '• Тёмная тема\n• SSO'])
    await page.reload()
    await expect(card(page, '2.9.1').getByLabel('Список изменений')).toHaveValue('• Тёмная тема\n• SSO')
  })

  test('удаление релиза просит подтверждения вторым нажатием', async ({ page }) => {
    await openApp(page, { settings: { page: 'releases' } })
    const c = card(page, '2.8.0')
    await c.getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect(c.getByRole('button', { name: 'Точно удалить?' })).toBeVisible()
    await c.getByRole('button', { name: 'Точно удалить?' }).click()
    await expect(page.locator('input[aria-label="Версия"]')).toHaveCount(2)
    await expect.poll(async () => (await webReleases(page)).map((r) => r.version)).toEqual(['2.9.0', '2.7.2'])
  })
})

// ----- Ошибки сервера -----

test.describe('плашка об ошибке', () => {
  test('сервер отказал: изменение откатывается и появляется плашка, потом она исчезает', async ({ page }) => {
    await openApp(page, { settings: { page: 'modules' } })
    await page.route('**/api/v1/modules/*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"internal","message":"x"}' }))
    const pill = page.locator('.cards-grid .panel').filter({ has: page.locator('input[value="Надёжность"]') }).locator('.pill-btn')
    await pill.click()
    const toast = page.getByText('Не удалось сохранить, изменение отменено')
    await expect(toast).toHaveText('Не удалось сохранить, изменение отменено')
    await expect(pill).toHaveText('Запланирован')
    await expect(toast).toBeHidden({ timeout: 8000 })
  })

  test('то же на доске: перенос задачи, которую сервер не принял', async ({ page }) => {
    await openApp(page, { settings: { page: 'backlog' } })
    await page.route('**/api/v1/tasks/*', (route) => (route.request().method() === 'PATCH' ? route.abort() : route.continue()))
    await page.locator('[data-row-id]:has-text("WEB-154")').getByRole('button', { name: 'На доску' }).click()
    await expect(page.getByText('Не удалось сохранить, изменение отменено')).toBeVisible()
    await expect(page.locator('[data-row-id]')).toHaveCount(5)
    await expect(page.locator('.side .count')).toHaveText('5')
  })
})
