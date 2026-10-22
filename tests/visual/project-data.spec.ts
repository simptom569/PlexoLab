import { expect, test, type Page } from '@playwright/test'
import { cards, cardTitles } from './docs-helpers'
import { openApp, resetData } from './fixtures'
import { apiAs, projectsOf, secondClient, statusAs } from './projects-helpers'

// Документы, ссылки и лента принадлежат проекту (docs/PROJECTS.md, раздел 2): у каждого проекта свои, вики общая.
// Заодно фильтр «Исполнитель» на доске: участники проекта и те, у кого в нём есть задачи.
// Сверка страниц первого проекта с эталоном лежит в docs.spec.ts, links.spec.ts и activity.spec.ts.

test.beforeEach(() => resetData())

const LENA = 'lena@example.com'

const nav = (page: Page) => page.getByRole('navigation', { name: 'Основная навигация' })
const go = (page: Page, item: string) => nav(page).getByRole('button', { name: item }).click()
const pickProject = (page: Page, name: string) => page.getByRole('navigation', { name: 'Проекты' }).getByRole('button', { name }).click()
const sections = (page: Page) => page.locator('main section')
const rows = (page: Page) => page.locator('.act-row')

async function projectByName(page: Page, name: string) {
  return (await projectsOf(page, LENA)).find((p) => p.name === name)!
}

// ===== Документы =====

test('у каждого проекта свои документы: в «Мобильном API» их нет, новый остаётся в нём', async ({ page }) => {
  await openApp(page, { settings: { page: 'docs' } })
  await expect(cards(page)).toHaveCount(4)

  await pickProject(page, 'Мобильный API')
  await expect(cards(page)).toHaveCount(0)
  await expect(page.getByText('Документов не найдено')).toBeVisible()

  await page.getByRole('button', { name: 'Новый документ' }).click()
  await expect(page.getByLabel('Название документа')).toBeVisible()
  await page.getByLabel('Название документа').fill('Контракт API')
  await page.getByLabel('Название документа').press('Enter')
  const api = await projectByName(page, 'Мобильный API')
  await expect.poll(async () => (await apiAs<Array<{ title: string }>>(page, LENA, `/projects/${api.id}/docs`)).map((d) => d.title)).toEqual(['Контракт API'])

  // в первом проекте документы прежние, чужого там нет
  const web = await projectByName(page, 'Web-приложение')
  expect((await apiAs<Array<{ title: string }>>(page, LENA, `/projects/${web.id}/docs`)).map((d) => d.title)).not.toContain('Контракт API')
  await pickProject(page, 'Web-приложение')
  await expect(cards(page)).toHaveCount(4)
  await expect(cardTitles(page).first()).not.toHaveText('Контракт API')
})

test('открытый документ не переезжает в другой проект: после смены проекта виден список', async ({ page }) => {
  await openApp(page, { settings: { page: 'docs' } })
  await cards(page).first().click()
  await expect(page.getByLabel('Название документа')).toBeVisible()

  await pickProject(page, 'Инфраструктура')
  await expect(page.getByLabel('Название документа')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Документы', level: 1 })).toBeVisible()
  await expect(cards(page)).toHaveCount(0)
})

// ===== Ссылки =====

test('у каждого проекта свои ссылки: в «Инфраструктуре» групп нет, новая остаётся в ней', async ({ page }) => {
  await openApp(page, { settings: { page: 'links' } })
  await expect(sections(page)).toHaveCount(4)

  await pickProject(page, 'Инфраструктура')
  await expect(page.getByText('Групп пока нет. Создай первую справа вверху')).toBeVisible()
  await expect(sections(page)).toHaveCount(0)

  await page.getByLabel('Название новой группы', { exact: true }).fill('Серверы')
  await page.getByLabel('Название новой группы', { exact: true }).press('Enter')
  await expect(sections(page)).toHaveCount(1)
  const infra = await projectByName(page, 'Инфраструктура')
  await expect.poll(async () => (await apiAs<Array<{ title: string }>>(page, LENA, `/projects/${infra.id}/link-groups`)).map((g) => g.title)).toEqual(['Серверы'])

  await pickProject(page, 'Web-приложение')
  await expect(sections(page)).toHaveCount(4)
  await pickProject(page, 'Инфраструктура')
  await expect(sections(page)).toHaveCount(1)
})

// ===== Лента =====

test('лента проекта: его события и события вики, чужих проектов в ней нет', async ({ page }) => {
  await openApp(page, { settings: { page: 'activity' } })
  await expect(rows(page)).toHaveCount(8) // сид: семь событий проекта и одно вики

  await pickProject(page, 'Мобильный API')
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toContainText('Страница «Архитектура» обновлена')
  await expect(rows(page).first().locator('.tag')).toHaveText('Вики')

  // действие в «Мобильном API» попадает в его ленту и не попадает в ленту «Web-приложения»
  const api = await projectByName(page, 'Мобильный API')
  await apiAs(page, LENA, `/projects/${api.id}/tasks`, { method: 'POST', data: { title: 'Новая задача API' } })
  await expect(rows(page)).toHaveCount(2)
  await expect(rows(page).first()).toContainText('Новая задача API')
  await pickProject(page, 'Web-приложение')
  await expect(rows(page)).toHaveCount(8)
})

test('создание документа пишется в ленту его проекта', async ({ page }) => {
  await openApp(page, { settings: { page: 'activity' } })
  const api = await projectByName(page, 'Мобильный API')
  await apiAs(page, LENA, `/projects/${api.id}/docs`, { method: 'POST', data: { title: 'Контракт' } })
  await pickProject(page, 'Мобильный API')
  await expect(rows(page).first()).toContainText('Документ «Контракт» создан')
  await pickProject(page, 'Web-приложение')
  await expect(rows(page)).toHaveCount(8)
})

// ===== Доступ и живые обновления =====

test('человек не из проекта не получает ни документов, ни ссылок, ни ленты проекта', async ({ page }) => {
  await openApp(page)
  const created = await apiAs<{ id: string }>(page, LENA, '/projects', { method: 'POST', data: { name: 'Закрытый' } })
  const doc = await apiAs<{ id: string }>(page, LENA, `/projects/${created.id}/docs`, { method: 'POST', data: { title: 'Секрет' } })
  const group = await apiAs<{ id: string }>(page, LENA, `/projects/${created.id}/link-groups`, { method: 'POST', data: { title: 'Тайные ссылки' } })

  for (const path of [
    `/projects/${created.id}/docs`,
    `/projects/${created.id}/link-groups`,
    `/projects/${created.id}/activity`,
    `/docs/${doc.id}`,
  ]) {
    expect(await statusAs(page, 'artem@example.com', path), `Артём: ${path}`).toBe(404)
    expect(await statusAs(page, LENA, path), `Лена: ${path}`).toBe(200)
  }
  expect(await statusAs(page, 'artem@example.com', `/link-groups/${group.id}`, { method: 'DELETE' })).toBe(404)
})

test('второй участник видит новый документ проекта без перезагрузки', async ({ page, browser }) => {
  await openApp(page, { settings: { page: 'docs' } })
  const artem = await secondClient(browser, 'artem@example.com', 'light', { page: 'docs' })
  try {
    await expect(cards(artem.page)).toHaveCount(4)
    const web = await projectByName(page, 'Web-приложение')
    await apiAs(page, LENA, `/projects/${web.id}/docs`, { method: 'POST', data: { title: 'Новый для всех' } })
    await expect(cards(artem.page)).toHaveCount(5)
    await expect(cardTitles(artem.page).first()).toHaveText('Новый для всех')
  } finally {
    await artem.close()
  }
})

// ===== Фильтр «Исполнитель» =====

test.describe('фильтр «Исполнитель»: участники проекта и те, у кого в нём есть задачи', () => {
  async function newProject(page: Page) {
    return apiAs<{ id: string }>(page, LENA, '/projects', { method: 'POST', data: { name: 'Сайт', key: 'PLX' } })
  }

  async function join(page: Page, project: string, email: string) {
    await apiAs(page, LENA, `/projects/${project}/invites`, { method: 'POST', data: { email } })
    const invites = await apiAs<Array<{ id: string; project_id: string }>>(page, email, '/invites')
    await apiAs(page, email, `/invites/${invites.find((i) => i.project_id === project)!.id}/accept`, { method: 'POST', data: {} })
  }

  async function assignees(page: Page): Promise<string[]> {
    await page.getByRole('button', { name: /^Фильтры/ }).click()
    const pop = page.getByRole('dialog', { name: 'Фильтры' })
    const people = ['Лена М.', 'Артём К.', 'Даниил С.', 'Соня В.', 'Игорь П.']
    const shown: string[] = []
    for (const name of people) if ((await pop.getByRole('button', { name, exact: true }).count()) > 0) shown.push(name)
    await page.keyboard.press('Escape')
    return shown
  }

  test('в новом проекте только его участники, потом вышедший остаётся, пока у него есть задачи', async ({ page }) => {
    const project = await newProject(page)
    await openApp(page, { settings: { project: project.id } })
    expect(await assignees(page)).toEqual(['Лена М.'])

    // пришли двое: участники в списке есть и без задач
    await join(page, project.id, 'artem@example.com')
    await join(page, project.id, 'sonya@example.com')
    await expect.poll(() => assignees(page)).toEqual(['Лена М.', 'Артём К.', 'Соня В.'])

    // у Артёма появилась задача, и его убрали из проекта: остаётся в фильтре, можно посмотреть, что он делал
    const board = await apiAs<{ columns: Array<{ id: string }> }>(page, LENA, `/projects/${project.id}/board`)
    const task = await apiAs<{ id: string }>(page, LENA, `/projects/${project.id}/tasks`, { method: 'POST', data: { title: 'Задача Артёма', column_id: board.columns[0].id } })
    const artem = (await apiAs<Array<{ id: string; email: string }>>(page, LENA, '/users')).find((u) => u.email === 'artem@example.com')!
    await apiAs(page, LENA, `/tasks/${task.id}`, { method: 'PATCH', data: { assignee_id: artem.id } })
    await apiAs(page, LENA, `/projects/${project.id}/members/${artem.id}`, { method: 'DELETE' })
    await expect.poll(() => assignees(page)).toEqual(['Лена М.', 'Артём К.', 'Соня В.'])

    await page.getByRole('button', { name: /^Фильтры/ }).click()
    await page.getByRole('dialog', { name: 'Фильтры' }).getByRole('button', { name: 'Артём К.', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-card-id]')).toHaveCount(1)
    await expect(page.locator('[data-card-id]')).toContainText('Задача Артёма')

    // задачу сняли с него: больше ни членства, ни задач, из списка он пропадает
    await apiAs(page, LENA, `/tasks/${task.id}`, { method: 'PATCH', data: { assignee_id: null } })
    await page.reload()
    await expect.poll(() => assignees(page)).toEqual(['Лена М.', 'Соня В.'])
  })

  test('в демо-проекте все пятеро участников, и список не пустеет без задач', async ({ page }) => {
    await openApp(page)
    expect(await assignees(page)).toEqual(['Лена М.', 'Артём К.', 'Даниил С.', 'Соня В.', 'Игорь П.'])
  })
})

// ===== Ответственный модуля и фильтр «Участник» в ленте =====

test.describe('люди из проекта: ответственный модуля и фильтр «Участник» в ленте', () => {
  async function newProject(page: Page) {
    return apiAs<{ id: string }>(page, LENA, '/projects', { method: 'POST', data: { name: 'Сайт', key: 'PLX' } })
  }

  async function join(page: Page, project: string, email: string) {
    await apiAs(page, LENA, `/projects/${project}/invites`, { method: 'POST', data: { email } })
    const invites = await apiAs<Array<{ id: string; project_id: string }>>(page, email, '/invites')
    await apiAs(page, email, `/invites/${invites.find((i) => i.project_id === project)!.id}/accept`, { method: 'POST', data: {} })
  }

  const userId = async (page: Page, email: string) => (await apiAs<Array<{ id: string; email: string }>>(page, LENA, '/users')).find((u) => u.email === email)!.id
  const leadButton = (page: Page) => page.locator('button[title="Сменить ответственного"]').first()
  const leadMenu = (page: Page) => page.getByRole('menu', { name: 'Ответственный' })
  const chips = (page: Page) => page.getByRole('group', { name: 'Участник' }).getByRole('button')
  // в тексте пункта списка первая буква — аватар, поэтому имена берём без неё
  const leadNames = async (page: Page) => (await leadMenu(page).getByRole('menuitemradio').allTextContents()).map((t) => t.slice(1))

  test('в списке ответственного только участники проекта, вышедший остаётся, пока он ответственный', async ({ page }) => {
    const project = await newProject(page)
    const module = await apiAs<{ id: string }>(page, LENA, `/projects/${project.id}/modules`, { method: 'POST', data: { title: 'Платежи' } })
    await openApp(page, { settings: { page: 'modules', project: project.id } })

    await expect(leadButton(page)).toContainText('Лена М.')
    await leadButton(page).click()
    expect(await leadNames(page)).toEqual(['Не назначен', 'Лена М.'])
    await page.keyboard.press('Escape')

    await join(page, project.id, 'artem@example.com')
    await expect
      .poll(async () => {
        await leadButton(page).click()
        const names = await leadNames(page)
        await page.keyboard.press('Escape')
        return names
      })
      .toEqual(['Не назначен', 'Лена М.', 'Артём К.'])

    // Артёма сделали ответственным и убрали из проекта: он остаётся в карточке и в списке, пока не выберут другого
    await apiAs(page, LENA, `/modules/${module.id}`, { method: 'PATCH', data: { lead_id: await userId(page, 'artem@example.com') } })
    await apiAs(page, LENA, `/projects/${project.id}/members/${await userId(page, 'artem@example.com')}`, { method: 'DELETE' })
    await page.reload()
    await expect(leadButton(page)).toContainText('Артём К.')
    await leadButton(page).click()
    expect(await leadNames(page)).toEqual(['Не назначен', 'Лена М.', 'Артём К.'])
    await leadMenu(page).getByRole('menuitemradio', { name: 'Лена М.' }).click()
    await expect(leadButton(page)).toContainText('Лена М.')
    await leadButton(page).click()
    expect(await leadNames(page)).toEqual(['Не назначен', 'Лена М.'])
  })

  test('сервер не даёт назначить ответственным того, кого нет в проекте', async ({ page }) => {
    await openApp(page)
    const project = await newProject(page)
    const module = await apiAs<{ id: string }>(page, LENA, `/projects/${project.id}/modules`, { method: 'POST', data: { title: 'Платежи' } })
    const status = await statusAs(page, LENA, `/modules/${module.id}`, { method: 'PATCH', data: { lead_id: await userId(page, 'igor@example.com') } })
    expect(status).toBe(400)
  })

  test('фильтр «Участник» в ленте: участники проекта и те, у кого в ленте есть события', async ({ page }) => {
    const project = await newProject(page)
    await openApp(page, { settings: { page: 'activity', project: project.id } })
    // в новом проекте только Лена. Артём написал страницу вики, и её событие видно в ленте любого проекта, но в этом
    // проекте его нет и своих событий у него здесь нет, поэтому в списке его тоже нет
    await expect(rows(page)).toHaveCount(1)
    await expect(rows(page).first()).toContainText('Артём К.')
    await expect.poll(() => chips(page).allTextContents()).toEqual(['Все', 'Лена М.'])

    // Даниил вошёл в проект: он участник, хоть событий у него нет
    await join(page, project.id, 'daniil@example.com')
    await expect.poll(() => chips(page).allTextContents()).toEqual(['Все', 'Лена М.', 'Даниил С.'])

    // а в демо-проекте, где все пятеро участники, видны все
    await pickProject(page, 'Web-приложение')
    await expect.poll(() => chips(page).allTextContents()).toEqual(['Все', 'Лена М.', 'Артём К.', 'Даниил С.', 'Соня В.', 'Игорь П.'])
  })

  test('сохранённый участник, которого нет в этой ленте, не прячет её: показываются все события', async ({ page }) => {
    const project = await newProject(page)
    await openApp(page, { settings: { page: 'activity', project: project.id, actWho: await userId(page, 'igor@example.com') } })
    await expect(rows(page)).toHaveCount(1) // событие вики
    await expect(chips(page).first()).toHaveAttribute('aria-pressed', 'true')
  })
})

// ===== Снимки списка ответственного (свои, в обеих темах: в макете такого списка нет) =====

for (const theme of ['light', 'dark'] as const) {
  test(`список ответственного модуля (${theme})`, async ({ page }) => {
    await openApp(page, { theme, settings: { page: 'modules' } })
    const card = page.locator('.cards-grid .panel').filter({ has: page.locator('input[aria-label="Название модуля"][value="SSO"]') })
    await card.locator('button[title="Сменить ответственного"]').click()
    const menu = page.getByRole('menu', { name: 'Ответственный' })
    await expect(menu).toBeVisible()
    await page.mouse.move(8, 8)
    await expect(menu).toHaveScreenshot(`lead-menu-${theme}.png`)
  })
}
