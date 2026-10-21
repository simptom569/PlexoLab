// Ссылки команды: сверка с эталоном (экран 19) и поведение: группы, ссылки, адрес с https://, открытие во внешней вкладке.

import { expect, test, type Page } from '@playwright/test'
import { compareToReference, type Rect } from './compare'
import { openApp, resetData } from './fixtures'
import { textRects } from './helpers'
import { MAX_DIFF_RATIO } from './tolerance'
import { api, webProjectId } from './wiki-helpers'

// Всё правее бокового меню: меню сверяется отдельно (sidebar.spec.ts)
const MAIN: Rect = { x: 233, y: 0, width: 1207, height: 900 }

type Group = { id: string; title: string; links: Array<{ id: string; title: string; url: string; description: string }> }

test.beforeEach(() => resetData())

const groupsOnServer = async (page: Page) => api<Group[]>(page, `/projects/${await webProjectId(page)}/link-groups`)

async function openLinks(page: Page, theme: 'light' | 'dark' = 'light') {
  await openApp(page, { theme, settings: { page: 'links' } })
  await expect(page.getByRole('heading', { name: 'Ссылки команды', level: 1 })).toBeVisible()
  await expect(page.locator('.link-card').first()).toBeVisible()
}

const sections = (page: Page) => page.locator('main section')
const section = (page: Page, title: string) => page.getByRole('region', { name: title, exact: true })
const titles = (page: Page) => page.getByLabel('Название группы', { exact: true })
const newGroup = (page: Page) => page.getByLabel('Название новой группы', { exact: true })

async function compare(page: Page, file: string, name: string) {
  const actual = await page.screenshot({ clip: MAIN })
  const text = await textRects(page, MAIN)
  const { diffPixels, total, diffRatio } = compareToReference({ actual, referenceFile: file, region: MAIN, ignore: text, name })
  console.log(`  ${name}: отличается ${diffPixels} из ${total} (${(diffRatio * 100).toFixed(3)}%), строк текста исключено: ${text.length}`)
  expect(diffRatio).toBeLessThan(MAX_DIFF_RATIO)
}

// ===== Экран 19 =====

for (const theme of ['light', 'dark'] as const) {
  test(`19 ссылки команды (${theme === 'light' ? 'светлая' : 'тёмная'} тема)`, async ({ page }) => {
    await openLinks(page, theme)
    await expect(sections(page)).toHaveCount(4)
    await page.mouse.move(800, 880)
    await compare(page, `19-links-${theme}.png`, `19-links-${theme}`)
  })
}

// ===== Что показывает страница =====

test('четыре группы, в них 3, 2, 2 и 3 ссылки; у ссылки название, адрес без https:// и описание', async ({ page }) => {
  await openLinks(page)
  const values = await titles(page).evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))
  expect(values).toEqual(['Код и сборка', 'Мониторинг', 'Дизайн', 'Окружения'])
  const counts = await sections(page).evaluateAll((els) => els.map((el) => el.querySelectorAll('.link-card').length))
  expect(counts).toEqual([3, 2, 2, 3])

  const card = section(page, 'Код и сборка').locator('.link-card').first()
  await expect(card.locator('strong')).toHaveText('Репозиторий web-приложения')
  await expect(card.locator('.mono')).toHaveText('example.com/git/web-app')
  await expect(card).toContainText('Основной код, ветки и pull request-ы')
  await expect(card.locator('a.link-main')).toHaveAttribute('href', 'https://example.com/git/web-app')
  await expect(card.locator('a.link-main')).toHaveAttribute('target', '_blank')
  await expect(card.locator('a.link-main')).toHaveAttribute('rel', 'noopener noreferrer')
})

test('в каждой группе плитка «Добавить ссылку» с двумя полями', async ({ page }) => {
  await openLinks(page)
  await expect(page.locator('.link-add')).toHaveCount(4)
  const add = section(page, 'Мониторинг').locator('.link-add')
  await expect(add.getByLabel('Название новой ссылки')).toHaveAttribute('placeholder', 'Название ссылки')
  await expect(add.getByLabel('Адрес новой ссылки')).toHaveAttribute('placeholder', 'Адрес, например example.com/repo')
  await expect(add.getByRole('button', { name: 'Добавить ссылку' })).toBeVisible()
})

// ===== Открытие ссылки =====

test('ссылка открывается во внешней вкладке, а само приложение остаётся на месте', async ({ page, context }) => {
  // адрес из сида условный: отвечаем за него сами, чтобы вкладка не ходила в интернет
  await context.route('https://example.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Внешняя страница</title>' }))
  await openLinks(page)
  const appUrl = page.url()

  const opened = context.waitForEvent('page')
  await section(page, 'Мониторинг').getByRole('link', { name: /Метрики сервисов/ }).click()
  const external = await opened
  await external.waitForLoadState()

  expect(external.url()).toBe('https://example.com/metrics')
  expect(page.url(), 'окно приложения никуда не переходило').toBe(appUrl)
  await expect(page.getByRole('heading', { name: 'Ссылки команды', level: 1 })).toBeVisible()
  expect(await external.evaluate(() => window.opener), 'вкладка без связи с приложением (noopener)').toBeNull()
})

test('средняя кнопка мыши тоже открывает внешнюю вкладку, а не окно приложения', async ({ page, context }) => {
  await context.route('https://example.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Внешняя страница</title>' }))
  await openLinks(page)
  const appUrl = page.url()

  const opened = context.waitForEvent('page')
  await section(page, 'Дизайн').getByRole('link', { name: /UI-кит/ }).click({ button: 'middle' })
  const external = await opened
  await external.waitForLoadState()
  expect(external.url()).toBe('https://example.com/ui-kit')
  expect(page.url()).toBe(appUrl)
  expect(context.pages().length).toBe(2)
})

// ===== Группы =====

test('новая группа: поле + Enter и кнопка «Группа», пустое название ничего не создаёт', async ({ page }) => {
  await openLinks(page)
  await page.getByRole('button', { name: 'Группа', exact: true }).click()
  await newGroup(page).fill('   ')
  await newGroup(page).press('Enter')
  await expect(sections(page)).toHaveCount(4)

  await newGroup(page).fill('Документация')
  await newGroup(page).press('Enter')
  await expect(sections(page)).toHaveCount(5)
  await expect(newGroup(page)).toHaveValue('')
  await expect(titles(page).last()).toHaveValue('Документация')
  await expect(sections(page).last().locator('.link-card')).toHaveCount(0)
  await expect(sections(page).last().locator('.link-add')).toBeVisible()

  await newGroup(page).fill('Календари')
  await page.getByRole('button', { name: 'Группа', exact: true }).click()
  await expect(sections(page)).toHaveCount(6)

  expect((await groupsOnServer(page)).map((g) => g.title)).toEqual(['Код и сборка', 'Мониторинг', 'Дизайн', 'Окружения', 'Документация', 'Календари'])
})

test('название группы правится на месте и сохраняется на сервере; пустое возвращает прежнее', async ({ page }) => {
  await openLinks(page)
  const title = titles(page).nth(1)
  await title.fill('Наблюдаемость')
  await title.press('Enter')
  await expect.poll(async () => (await groupsOnServer(page))[1]!.title).toBe('Наблюдаемость')
  await expect(sections(page).nth(1)).toHaveAccessibleName('Наблюдаемость')

  await title.fill('   ')
  await title.press('Enter')
  await expect(title).toHaveValue('Наблюдаемость')
  expect((await groupsOnServer(page))[1]!.title).toBe('Наблюдаемость')

  await page.reload()
  await expect(titles(page).nth(1)).toHaveValue('Наблюдаемость')
})

test('удаление группы в два шага: «Удалить» → «Точно удалить?», ссылки уходят вместе с ней', async ({ page }) => {
  await openLinks(page)
  const design = section(page, 'Дизайн')
  const button = design.getByRole('button', { name: /Удалить$|Точно удалить\?/ })
  await expect(button).toHaveText('Удалить')
  await button.click()
  await expect(button).toHaveText('Точно удалить?')
  await expect(sections(page)).toHaveCount(4)
  await button.click()
  await expect(sections(page)).toHaveCount(3)
  await expect(page.getByText('Макеты интерфейса')).toHaveCount(0)

  const left = await groupsOnServer(page)
  expect(left.map((g) => g.title)).toEqual(['Код и сборка', 'Мониторинг', 'Окружения'])
})

test('подтверждение удаления группы сбрасывается при уходе со страницы', async ({ page }) => {
  await openLinks(page)
  const button = section(page, 'Дизайн').getByRole('button', { name: /Удалить$|Точно удалить\?/ })
  await button.click()
  await expect(button).toHaveText('Точно удалить?')
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Активность' }).click()
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Ссылки команды' }).click()
  await expect(section(page, 'Дизайн').getByRole('button', { name: /Удалить$|Точно удалить\?/ })).toHaveText('Удалить')
  expect(await groupsOnServer(page)).toHaveLength(4)
})

test('когда групп не осталось, страница так и говорит', async ({ page }) => {
  for (const g of await groupsOnServer(page)) await api(page, `/link-groups/${g.id}`, { method: 'DELETE' })
  await openApp(page, { settings: { page: 'links' } })
  await expect(page.getByText('Групп пока нет. Создай первую справа вверху')).toBeVisible()
  await expect(sections(page)).toHaveCount(0)
})

// ===== Ссылки =====

test('новая ссылка: название и адрес без схемы — на сервер уходит https://, плитка очищается', async ({ page }) => {
  await openLinks(page)
  const group = section(page, 'Мониторинг')
  const add = group.locator('.link-add')
  await add.getByLabel('Название новой ссылки').fill('Алерты')
  await add.getByLabel('Адрес новой ссылки').fill('example.com/alerts')
  await add.getByRole('button', { name: 'Добавить ссылку' }).click()

  await expect(group.locator('.link-card')).toHaveCount(3)
  const card = group.locator('.link-card').last()
  await expect(card.locator('strong')).toHaveText('Алерты')
  await expect(card.locator('.mono')).toHaveText('example.com/alerts')
  await expect(card.locator('a.link-main')).toHaveAttribute('href', 'https://example.com/alerts')
  await expect(add.getByLabel('Название новой ссылки')).toHaveValue('')
  await expect(add.getByLabel('Адрес новой ссылки')).toHaveValue('')

  const saved = (await groupsOnServer(page))[1]!.links
  expect(saved.map((l) => [l.title, l.url])).toEqual([
    ['Метрики сервисов', 'https://example.com/metrics'],
    ['Журнал ошибок', 'https://example.com/errors'],
    ['Алерты', 'https://example.com/alerts'],
  ])
})

test('адрес со схемой сохраняется как есть, Enter в любом поле добавляет ссылку', async ({ page }) => {
  await openLinks(page)
  const group = section(page, 'Дизайн')
  const add = group.locator('.link-add')
  await add.getByLabel('Название новой ссылки').fill('Старый стенд')
  await add.getByLabel('Адрес новой ссылки').fill('http://old.example.com/')
  await add.getByLabel('Адрес новой ссылки').press('Enter')
  await expect(group.locator('.link-card')).toHaveCount(3)

  await add.getByLabel('Название новой ссылки').fill('Ещё')
  await add.getByLabel('Адрес новой ссылки').fill('  example.com/more  ')
  await add.getByLabel('Название новой ссылки').press('Enter')
  await expect(group.locator('.link-card')).toHaveCount(4)

  const links = (await groupsOnServer(page))[2]!.links
  expect(links.slice(2).map((l) => l.url)).toEqual(['http://old.example.com/', 'https://example.com/more'])
})

test('без названия или без адреса ссылка не добавляется и введённое остаётся в полях', async ({ page }) => {
  await openLinks(page)
  const group = section(page, 'Дизайн')
  const add = group.locator('.link-add')
  await add.getByLabel('Название новой ссылки').fill('Без адреса')
  await add.getByRole('button', { name: 'Добавить ссылку' }).click()
  await expect(group.locator('.link-card')).toHaveCount(2)
  await expect(add.getByLabel('Название новой ссылки')).toHaveValue('Без адреса')

  await add.getByLabel('Название новой ссылки').fill('')
  await add.getByLabel('Адрес новой ссылки').fill('example.com/x')
  await add.getByRole('button', { name: 'Добавить ссылку' }).click()
  await expect(group.locator('.link-card')).toHaveCount(2)
  await expect(add.getByLabel('Адрес новой ссылки')).toHaveValue('example.com/x')
  expect((await groupsOnServer(page))[2]!.links).toHaveLength(2)
})

test('у каждой группы свои поля: введённое в одной плитке не попадает в другую', async ({ page }) => {
  await openLinks(page)
  await section(page, 'Дизайн').getByLabel('Название новой ссылки').fill('Черновик')
  await expect(section(page, 'Мониторинг').getByLabel('Название новой ссылки')).toHaveValue('')
})

test('удаление ссылки крестиком: сразу на экране и на сервере', async ({ page }) => {
  await openLinks(page)
  const group = section(page, 'Код и сборка')
  await group.getByRole('button', { name: 'Удалить ссылку Репозиторий API' }).click()
  await expect(group.locator('.link-card')).toHaveCount(2)
  await expect(group.getByText('Репозиторий API')).toHaveCount(0)
  await expect.poll(async () => (await groupsOnServer(page))[0]!.links.map((l) => l.title)).toEqual(['Репозиторий web-приложения', 'Сборки и пайплайны'])
  // остальные группы не тронуты
  await expect(sections(page).nth(1).locator('.link-card')).toHaveCount(2)
})

test('сервер отказал: изменение откатывается и появляется плашка об ошибке', async ({ page }) => {
  await openLinks(page)
  await page.route('**/api/v1/links/*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'internal', message: 'сбой' }) }))
  const group = section(page, 'Код и сборка')
  await group.getByRole('button', { name: 'Удалить ссылку Репозиторий API' }).click()
  await expect(page.getByText('Не удалось сохранить, изменение отменено')).toBeVisible()
  await expect(group.locator('.link-card')).toHaveCount(3)
  await expect(group.getByText('Репозиторий API')).toBeVisible()
})
