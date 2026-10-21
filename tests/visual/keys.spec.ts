import { expect, test, type Locator, type Page } from '@playwright/test'
import { openApp, resetData } from './fixtures'
import { apiAs, projectsOf, secondClient } from './projects-helpers'

// Ключи задач у модулей и проектов (docs/PROJECTS.md, разделы 3 и 4): поле «Ключ задач» в карточке модуля, окно
// «У N задач изменятся id. Продолжить?», смена ряда при переносе задачи, сортировка таблицы по ID. Окна не из макета,
// поэтому их снимки свои, в обеих темах. Карточки модулей в покое сверяются с эталоном в work.spec.ts.

test.beforeEach(() => resetData())

const LENA = 'lena@example.com'

type Board = {
  columns: Array<{ id: string; title: string }>
  tasks: Array<{ id: string; key: string; title: string; module_id: string | null }>
  modules: Array<{ id: string; title: string; key: string | null }>
}

type Site = { id: string; todo: string }

const boardOf = (page: Page, id: string) => apiAs<Board>(page, LENA, `/projects/${id}/board`)

/** Проект «Сайт» с ключом PLX (или без него), в нём четыре колонки макета */
async function newSite(page: Page, key: string | null = 'PLX'): Promise<Site> {
  const project = await apiAs<{ id: string }>(page, LENA, '/projects', { method: 'POST', data: { name: 'Сайт', key } })
  const board = await boardOf(page, project.id)
  return { id: project.id, todo: board.columns[0].id }
}

async function addTask(page: Page, site: Site, title: string): Promise<string> {
  const task = await apiAs<{ id: string }>(page, LENA, `/projects/${site.id}/tasks`, { method: 'POST', data: { title, column_id: site.todo } })
  return task.id
}

async function addModule(page: Page, site: Site, title: string, key?: string): Promise<string> {
  const module = await apiAs<{ id: string }>(page, LENA, `/projects/${site.id}/modules`, { method: 'POST', data: { title } })
  if (key) await apiAs(page, LENA, `/modules/${module.id}`, { method: 'PATCH', data: { key } })
  return module.id
}

const putIn = (page: Page, task: string, module: string | null) =>
  apiAs(page, LENA, `/tasks/${task}`, { method: 'PATCH', data: { module_id: module } })

/** Id задач проекта по названиям, как их видит сервер */
async function labels(page: Page, site: Site): Promise<Record<string, string>> {
  const board = await boardOf(page, site.id)
  return Object.fromEntries(board.tasks.map((t) => [t.title, t.key]))
}

const moduleKey = async (page: Page, site: Site, title: string) => (await boardOf(page, site.id)).modules.find((m) => m.title === title)?.key

const openModules = (page: Page, site: Site, theme: 'light' | 'dark' = 'light') =>
  openApp(page, { theme, settings: { page: 'modules', project: site.id } })

const card = (page: Page, title: string) =>
  page.locator('.cards-grid .panel').filter({ has: page.locator(`input[aria-label="Название модуля"][value="${title}"]`) })
const keyField = (c: Locator) => c.getByRole('textbox', { name: 'Ключ задач' })
const idsIn = (c: Locator) => c.locator('.mini-task .mono')
const askDialog = (page: Page) => page.getByRole('dialog', { name: /изменятся id/ })
const drawer = (page: Page) => page.getByRole('dialog', { name: /^Задача / })

async function typeKey(c: Locator, key: string) {
  await keyField(c).fill(key)
  await keyField(c).press('Enter')
}

// ===== Пример из документа в интерфейсе =====

test('пример из раздела 4.4: задачи меняют ряд в окне задачи, ключ переименовывается и ставится впервые', async ({ page }) => {
  const site = await newSite(page)
  const seo = await addModule(page, site, 'SEO', 'SEO')
  const design = await addModule(page, site, 'Дизайн')
  const t1 = await addTask(page, site, 'Первая')
  const t2 = await addTask(page, site, 'Вторая')
  await openApp(page, { settings: { project: site.id } })

  // 1–2. две задачи без модуля; «Вторая» в модуль SEO получает SEO-1
  expect(await labels(page, site)).toMatchObject({ Первая: 'PLX-1', Вторая: 'PLX-2' })
  await page.locator('.card', { hasText: 'Вторая' }).click()
  await drawer(page).getByRole('button', { name: 'SEO', exact: true }).click()
  await expect(drawer(page)).toContainText('SEO-1')

  // 3–5. новая задача PLX-3; из SEO в «Дизайн» (ключа нет) PLX-4; из «Дизайна» в «Не выбран» тот же PLX-4
  const t3 = await addTask(page, site, 'Третья')
  expect((await labels(page, site)).Третья).toBe('PLX-3')
  await drawer(page).getByRole('button', { name: 'Дизайн', exact: true }).click()
  await expect(drawer(page)).toContainText('PLX-4')
  await drawer(page).getByRole('button', { name: 'Не выбран' }).first().click()
  await expect(drawer(page)).toContainText('PLX-4')
  await expect.poll(async () => (await labels(page, site)).Вторая).toBe('PLX-4')
  await page.getByRole('button', { name: 'Закрыть задачу' }).click()

  // 6. «Первая» в SEO (SEO-2); ключ SEO переименовали в MKT: подпись другая, номер тот же
  await putIn(page, t1, seo)
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Модули' }).click()
  await page.reload()
  await expect(idsIn(card(page, 'SEO'))).toHaveText(['SEO-2'])
  await typeKey(card(page, 'SEO'), 'mkt')
  await expect(askDialog(page)).toContainText('У 1 задачи изменятся id')
  await expect(askDialog(page)).toContainText('изменится только префикс: SEO-… станет MKT-…')
  await askDialog(page).getByRole('button', { name: 'Продолжить' }).click()
  await expect(askDialog(page)).toHaveCount(0)
  await expect(idsIn(card(page, 'SEO'))).toHaveText(['MKT-2'])
  await expect(keyField(card(page, 'SEO'))).toHaveValue('MKT')

  // 7. «Дизайну» с тремя задачами впервые дали ключ DSN: окно, потом DSN-1..3 по порядку старых номеров
  const t4 = await addTask(page, site, 'Четвёртая')
  for (const t of [t3, t4]) await putIn(page, t, design)
  await putIn(page, t2, design)
  await page.reload()
  await expect(idsIn(card(page, 'Дизайн'))).toHaveText(['PLX-3', 'PLX-4', 'PLX-5'])
  await typeKey(card(page, 'Дизайн'), 'dsn')
  await expect(askDialog(page)).toContainText('У 3 задач изменятся id')
  await expect(askDialog(page)).toContainText('DSN-1, DSN-2')
  await askDialog(page).getByRole('button', { name: 'Продолжить' }).click()
  await expect(idsIn(card(page, 'Дизайн'))).toHaveText(['DSN-1', 'DSN-2', 'DSN-3'])
  expect(await labels(page, site)).toEqual({ Первая: 'MKT-2', Вторая: 'DSN-2', Третья: 'DSN-1', Четвёртая: 'DSN-3' })
})

// ===== Окно подтверждения =====

test.describe('окно «У N задач изменятся id»', () => {
  test('«Отмена» и Esc ничего не меняют, поле возвращает прежний ключ', async ({ page }) => {
    const site = await newSite(page)
    const module = await addModule(page, site, 'Платежи')
    for (const title of ['A', 'B']) await putIn(page, await addTask(page, site, title), module)
    await openModules(page, site)
    const c = card(page, 'Платежи')

    await typeKey(c, 'pay')
    await expect(askDialog(page)).toContainText('У 2 задач изменятся id')
    await page.keyboard.press('Escape')
    await expect(askDialog(page)).toHaveCount(0)
    await expect(keyField(c)).toHaveValue('')

    await typeKey(c, 'pay')
    await askDialog(page).getByRole('button', { name: 'Отмена' }).click()
    await expect(askDialog(page)).toHaveCount(0)
    await expect(keyField(c)).toHaveValue('')
    expect(await moduleKey(page, site, 'Платежи')).toBeNull()
    expect(await labels(page, site)).toEqual({ A: 'PLX-1', B: 'PLX-2' })
  })

  test('у модуля без задач ключ сохраняется сразу, без вопроса', async ({ page }) => {
    const site = await newSite(page)
    await addModule(page, site, 'Пустой')
    await openModules(page, site)
    await typeKey(card(page, 'Пустой'), 'emp')
    await expect(askDialog(page)).toHaveCount(0)
    await expect.poll(() => moduleKey(page, site, 'Пустой')).toBe('EMP')
    await expect(keyField(card(page, 'Пустой'))).toHaveValue('EMP')
  })

  test('снять ключ: вопрос называет, куда уйдут задачи, и они получают новые номера', async ({ page }) => {
    const site = await newSite(page)
    const module = await addModule(page, site, 'SEO', 'SEO')
    for (const title of ['A', 'B']) await putIn(page, await addTask(page, site, title), module)
    await openModules(page, site)
    const c = card(page, 'SEO')
    await expect(idsIn(c)).toHaveText(['SEO-1', 'SEO-2'])

    await typeKey(c, '')
    await expect(askDialog(page)).toContainText('У 2 задач изменятся id')
    await expect(askDialog(page)).toContainText('вернутся в нумерацию проекта (PLX-…)')
    await askDialog(page).getByRole('button', { name: 'Продолжить' }).click()
    await expect(idsIn(c)).toHaveText(['PLX-3', 'PLX-4'])
    await expect(keyField(c)).toHaveValue('')
    expect(await moduleKey(page, site, 'SEO')).toBeNull()
  })

  test('неизменённый ключ вопроса не вызывает', async ({ page }) => {
    const site = await newSite(page)
    const module = await addModule(page, site, 'SEO', 'SEO')
    await putIn(page, await addTask(page, site, 'A'), module)
    await openModules(page, site)
    await typeKey(card(page, 'SEO'), ' seo ')
    await expect(askDialog(page)).toHaveCount(0)
    await expect(keyField(card(page, 'SEO'))).toHaveValue('SEO')
  })
})

// ===== Ошибки ключа =====

test('ключ с ошибкой остаётся на месте с пояснением, а поле возвращает прежнее значение', async ({ page }) => {
  const site = await newSite(page)
  await addModule(page, site, 'SEO', 'SEO')
  await addModule(page, site, 'Дизайн')
  await openModules(page, site)
  const c = card(page, 'Дизайн')

  await typeKey(c, '1ab')
  await expect(c.getByRole('alert')).toHaveText('Ключ: от 2 до 6 символов, латиница и цифры, начинается с буквы')
  await expect(keyField(c)).toHaveValue('')

  await typeKey(c, 'seo')
  await expect(c.getByRole('alert')).toHaveText('Такой ключ уже есть в этом проекте')
  await expect(keyField(c)).toHaveValue('')

  await typeKey(c, 'plx')
  await expect(c.getByRole('alert')).toHaveText('Такой ключ уже у проекта')

  // начали править заново: сообщение уходит
  await keyField(c).fill('d')
  await expect(c.getByRole('alert')).toHaveCount(0)
  expect(await moduleKey(page, site, 'Дизайн')).toBeNull()
})

test('в проекте без ключа слово TASK занято: так подписаны его задачи', async ({ page }) => {
  const site = await newSite(page, null)
  await addModule(page, site, 'Модуль')
  await openModules(page, site)
  const c = card(page, 'Модуль')
  await expect(keyField(c)).toHaveAttribute('placeholder', 'TASK')
  await typeKey(c, 'task')
  await expect(c.getByRole('alert')).toContainText('Ключ TASK занят')
})

// ===== Ключ проекта =====

test.describe('ключ проекта в «Настройках проекта»', () => {
  async function openMainSettings(page: Page) {
    await page.getByRole('navigation', { name: 'Проекты' }).getByRole('button', { name: 'Сайт' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Настройки проекта' }).click()
    const dialog = page.getByRole('dialog', { name: /^Настройки проекта/ })
    await expect(dialog).toBeVisible()
    return dialog
  }

  test('спрашивает про задачи ряда проекта, Esc закрывает только вопрос, «Продолжить» сохраняет', async ({ page }) => {
    const site = await newSite(page)
    const module = await addModule(page, site, 'SEO', 'SEO')
    await addTask(page, site, 'A')
    await addTask(page, site, 'B')
    await putIn(page, await addTask(page, site, 'C'), module)
    await openApp(page, { settings: { project: site.id } })
    const settings = await openMainSettings(page)

    await settings.getByLabel('Ключ задач').fill('web')
    await settings.getByRole('button', { name: 'Сохранить' }).click()
    // в ряду проекта две задачи, третья в ряду модуля: её подпись не меняется
    await expect(askDialog(page)).toContainText('У 2 задач изменятся id')
    await expect(askDialog(page)).toContainText('PLX-… станет WEB-…')

    // Esc закрывает только вопрос, окно настроек остаётся
    await page.keyboard.press('Escape')
    await expect(askDialog(page)).toHaveCount(0)
    await expect(settings).toBeVisible()
    expect((await projectsOf(page, LENA)).find((p) => p.id === site.id)?.key).toBe('PLX')

    await settings.getByRole('button', { name: 'Сохранить' }).click()
    await askDialog(page).getByRole('button', { name: 'Продолжить' }).click()
    await expect(settings.getByRole('status')).toHaveText('Сохранено')
    expect((await projectsOf(page, LENA)).find((p) => p.id === site.id)?.key).toBe('WEB')
    expect(await labels(page, site)).toEqual({ A: 'WEB-1', B: 'WEB-2', C: 'SEO-1' })
  })

  test('проект без задач меняет ключ сразу', async ({ page }) => {
    const site = await newSite(page)
    await openApp(page, { settings: { project: site.id } })
    const settings = await openMainSettings(page)
    await settings.getByLabel('Ключ задач').fill('web')
    await settings.getByRole('button', { name: 'Сохранить' }).click()
    await expect(askDialog(page)).toHaveCount(0)
    await expect(settings.getByRole('status')).toHaveText('Сохранено')
  })

  test('название без смены ключа сохраняется без вопроса', async ({ page }) => {
    const site = await newSite(page)
    await addTask(page, site, 'A')
    await openApp(page, { settings: { project: site.id } })
    const settings = await openMainSettings(page)
    await settings.getByLabel('Название').fill('Сайт компании')
    await settings.getByRole('button', { name: 'Сохранить' }).click()
    await expect(askDialog(page)).toHaveCount(0)
    await expect(settings.getByRole('status')).toHaveText('Сохранено')
  })
})

// ===== Таблица =====

test('таблица: сортировка по ID идёт по ключу, потом по номеру', async ({ page }) => {
  const site = await newSite(page)
  const [aaa, bbb] = [await addModule(page, site, 'Первый', 'AAA'), await addModule(page, site, 'Второй', 'BBB')]
  const ids: string[] = []
  for (let i = 1; i <= 10; i++) ids.push(await addTask(page, site, `Задача ${i}`))
  await putIn(page, ids[2], aaa)
  await putIn(page, ids[3], bbb)
  await putIn(page, ids[5], aaa)
  await openApp(page, { settings: { view: 'table', project: site.id } })
  const shown = () => page.locator('.trow:not(.thead) .mono').allTextContents()

  // таблица открывается отсортированной по ID по возрастанию; клик по заголовку разворачивает
  await expect.poll(shown).toEqual(['AAA-1', 'AAA-2', 'BBB-1', 'PLX-1', 'PLX-2', 'PLX-5', 'PLX-7', 'PLX-8', 'PLX-9', 'PLX-10'])
  await page.getByRole('button', { name: /^ID/ }).click()
  await expect.poll(shown).toEqual(['PLX-10', 'PLX-9', 'PLX-8', 'PLX-7', 'PLX-5', 'PLX-2', 'PLX-1', 'BBB-1', 'AAA-2', 'AAA-1'])
  await page.getByRole('button', { name: /^ID/ }).click()
  await expect.poll(shown).toEqual(['AAA-1', 'AAA-2', 'BBB-1', 'PLX-1', 'PLX-2', 'PLX-5', 'PLX-7', 'PLX-8', 'PLX-9', 'PLX-10'])
})

// ===== Два клиента =====

test('у второго человека id меняются сами, и открытая у него задача показывает новый', async ({ page, browser }) => {
  await openApp(page, { settings: { page: 'modules' } })
  const artem = await secondClient(browser, 'artem@example.com', 'light', { page: 'modules' })
  try {
    const mine = card(page, 'SSO')
    const his = card(artem.page, 'SSO')
    await expect(idsIn(his)).toHaveText(['WEB-144', 'WEB-158'])

    await typeKey(mine, 'sso')
    await expect(askDialog(page)).toContainText('У 2 задач изменятся id')
    await askDialog(page).getByRole('button', { name: 'Продолжить' }).click()
    await expect(idsIn(mine)).toHaveText(['SSO-1', 'SSO-2'])

    await expect(idsIn(his)).toHaveText(['SSO-1', 'SSO-2'])
    await expect(keyField(his)).toHaveValue('SSO')

    // и когда человек открыл задачу: её подпись обновляется на месте
    await artem.page.locator('.mini-task', { hasText: 'SSO-1' }).getByRole('button').click()
    await expect(drawer(artem.page)).toContainText('SSO-1')
    await typeKey(mine, 'idp')
    await askDialog(page).getByRole('button', { name: 'Продолжить' }).click()
    await expect(drawer(artem.page)).toContainText('IDP-1')
  } finally {
    await artem.close()
  }
})

// ===== Снимки окон =====

for (const theme of ['light', 'dark'] as const) {
  test(`окно подтверждения (${theme})`, async ({ page }) => {
    const site = await newSite(page)
    const module = await addModule(page, site, 'Дизайн')
    for (const title of ['Макеты', 'Иконки', 'Цвета']) await putIn(page, await addTask(page, site, title), module)
    await openModules(page, site, theme)
    await page.mouse.move(8, 8)

    await typeKey(card(page, 'Дизайн'), 'dsn')
    await expect(askDialog(page)).toBeVisible()
    await page.mouse.move(8, 8)
    await expect(askDialog(page)).toHaveScreenshot(`id-change-${theme}.png`)
    await page.keyboard.press('Escape')

    // и поверх «Настроек проекта»: подложка и окно выше нижнего окна
    await page.getByRole('navigation', { name: 'Проекты' }).getByRole('button', { name: 'Сайт' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Настройки проекта' }).click()
    const settings = page.getByRole('dialog', { name: /^Настройки проекта/ })
    await settings.getByLabel('Ключ задач').fill('web')
    await settings.getByRole('button', { name: 'Сохранить' }).click()
    await expect(askDialog(page)).toBeVisible()
    await page.mouse.move(8, 8)
    await expect(page).toHaveScreenshot(`id-change-over-settings-${theme}.png`)
  })
}
