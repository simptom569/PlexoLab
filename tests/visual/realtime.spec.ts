// Живые обновления: два запущенных клиента видят изменения друг друга за 1–2 секунды, обрыв связи лечится
// переподключением, а свои действия не вызывают лишних запросов. Протокол сокета и таблица событий проверяются
// в серверных тестах (realtime.rs, events.rs), здесь поведение клиента.

import { expect, test, type Browser, type Page } from '@playwright/test'
import { docFull, docId, type DocObject } from './docs-helpers'
import { openApp, resetData, SERVER } from './fixtures'
import { api, idOf, wikiPage } from './wiki-helpers'

test.beforeEach(() => resetData())

/** «За 1–2 секунды» из плана этапа: чужое изменение должно появиться не позже */
const LIVE = { timeout: 2000 }

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name })
const dot = (page: Page) => page.locator('[data-connection]')
const sections = (page: Page) => page.locator('main section')
const groupTitles = (page: Page) => page.getByLabel('Название группы', { exact: true })
const card = (page: Page, key: string) => page.locator('[data-card-id]', { hasText: key })
const column = (page: Page, title: string) => page.locator('.col', { has: page.locator('h2', { hasText: new RegExp(`^${title}$`) }) })
const drawer = (page: Page) => page.getByRole('dialog', { name: /^Задача / })
const rows = (page: Page) => page.locator('.act-row')

/** Второй клиент: отдельное окно браузера со своим входом, как второй человек за другим компьютером */
async function secondClient(browser: Browser, settings: Record<string, unknown>): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU', timezoneId: 'UTC', reducedMotion: 'reduce' })
  const page = await context.newPage()
  await openApp(page, { email: 'artem@example.com', settings })
  return { page, close: () => context.close() }
}

/** Считает запросы страницы к адресам, содержащим `part` (кроме загрузок до вызова) */
function countGets(page: Page, part: string): { hits: string[] } {
  const hits: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'GET' && r.url().includes(part)) hits.push(r.url())
  })
  return { hits }
}

type Project = { id: string; key: string }
const webProject = async (page: Page) => (await api<Project[]>(page, '/projects')).find((p) => p.key === 'WEB')!
type BoardTask = { id: string; key: string; title: string; column_id: string | null }
const webBoard = async (page: Page) =>
  api<{ tasks: BoardTask[]; columns: Array<{ id: string; title: string }> }>(page, `/projects/${(await webProject(page)).id}/board`)

// ===== Точка связи =====

test.describe('точка связи в боковом меню', () => {
  test('после входа точка зелёная, у неё есть подпись для скринридера', async ({ page }) => {
    await openApp(page)
    await expect(dot(page)).toHaveAttribute('data-connection', 'open')
    await expect(dot(page)).toHaveAccessibleName('Связь с сервером есть: изменения других участников видны сразу')
    await expect(dot(page)).toHaveCSS('background-color', 'rgb(23, 113, 76)') // --ok светлой темы
  })

  test('в тёмной теме цвет берётся из переменных темы', async ({ page }) => {
    await openApp(page, { theme: 'dark' })
    await expect(dot(page)).toHaveAttribute('data-connection', 'open')
    await expect(dot(page)).toHaveCSS('background-color', 'rgb(76, 195, 138)') // --ok тёмной темы
  })

  test('точка лежит поверх аватара и не меняет размеров и положения ничего вокруг', async ({ page }) => {
    await openApp(page)
    await expect(dot(page)).toHaveAttribute('data-connection', 'open')
    const measure = () =>
      page.evaluate(() => {
        const rect = (el: Element | null) => {
          const r = el!.getBoundingClientRect()
          return [r.x, r.y, r.width, r.height]
        }
        const button = document.querySelector('.side button[aria-haspopup="menu"]')
        return { side: rect(document.querySelector('.side')), button: rect(button), avatar: rect(button!.querySelector('.avatar')), name: rect(button!.querySelector('strong')) }
      })
    const withDot = await measure()
    await page.evaluate(() => document.querySelector('[data-connection]')!.remove())
    expect(await measure()).toEqual(withDot)
  })
})

// ===== Два клиента =====

test.describe('чужие изменения видны сразу', () => {
  test('группа ссылок, созданная в одном окне, появляется в другом, а потом и переименование с удалением', async ({ page, browser }) => {
    await openApp(page, { settings: { page: 'links' } })
    const other = await secondClient(browser, { page: 'links' })
    try {
      await expect(sections(other.page)).toHaveCount(4)

      await page.getByLabel('Название новой группы', { exact: true }).fill('Из первого окна')
      await page.getByLabel('Название новой группы', { exact: true }).press('Enter')
      await expect(sections(other.page)).toHaveCount(5, LIVE)
      await expect(groupTitles(other.page).last()).toHaveValue('Из первого окна')

      await groupTitles(page).last().fill('Переименована')
      await groupTitles(page).last().press('Enter')
      await expect(groupTitles(other.page).last()).toHaveValue('Переименована', LIVE)

      const group = sections(page).last()
      await group.getByRole('button', { name: 'Удалить' }).click()
      await group.getByRole('button', { name: 'Точно удалить?' }).click()
      await expect(sections(other.page)).toHaveCount(4, LIVE)
    } finally {
      await other.close()
    }
  })

  test('новая задача, созданная в одном окне, и перенос задачи появляются на доске другого', async ({ page, browser }) => {
    await openApp(page)
    const other = await secondClient(browser, {})
    try {
      const todo = column(other.page, 'К выполнению').locator('[data-card-id]')
      const before = await todo.count()

      await page.getByRole('button', { name: 'Новая задача' }).click()
      await expect(drawer(page)).toBeVisible()
      await expect(todo).toHaveCount(before + 1, LIVE)
      await expect(column(other.page, 'К выполнению')).toContainText('Новая задача')

      // перенос: задача уходит из колонки в колонку, пока второе окно смотрит на доску
      const board = await webBoard(page)
      const done = board.columns.find((c) => c.title === 'Готово')!
      const task = board.tasks.find((t) => t.key === 'WEB-151')!
      await api(page, `/tasks/${task.id}`, { method: 'PATCH', data: { column_id: done.id, before_id: null } })
      await expect(column(other.page, 'Готово')).toContainText('WEB-151', LIVE)
      await expect(column(page, 'К выполнению')).not.toContainText('WEB-151', LIVE)
    } finally {
      await other.close()
    }
  })

  test('комментарий к открытой задаче появляется в панели другого окна', async ({ page, browser }) => {
    await openApp(page)
    const other = await secondClient(browser, {})
    try {
      await card(other.page, 'WEB-144').getByRole('button', { name: 'Вход через SSO для корпоративных аккаунтов' }).click()
      await expect(drawer(other.page)).toBeVisible()
      const task = (await webBoard(page)).tasks.find((t) => t.key === 'WEB-144')!
      await api(page, `/tasks/${task.id}/comments`, { method: 'POST', data: { body: 'Проверьте на стейдже' } })
      await expect(drawer(other.page)).toContainText('Проверьте на стейдже', LIVE)
    } finally {
      await other.close()
    }
  })

  test('задачу удалили, пока она открыта в панели: панель закрывается, карточки нет', async ({ page, browser }) => {
    await openApp(page)
    const other = await secondClient(browser, {})
    try {
      await card(other.page, 'WEB-144').getByRole('button', { name: 'Вход через SSO для корпоративных аккаунтов' }).click()
      await expect(drawer(other.page)).toBeVisible()
      const task = (await webBoard(page)).tasks.find((t) => t.key === 'WEB-144')!
      await api(page, `/tasks/${task.id}`, { method: 'DELETE' })
      await expect(drawer(other.page)).toHaveCount(0, LIVE)
      await expect(card(other.page, 'WEB-144')).toHaveCount(0)
    } finally {
      await other.close()
    }
  })

  test('лента активности пополняется чужими действиями', async ({ page, browser }) => {
    await openApp(page, { settings: { page: 'activity' } })
    await expect(rows(page)).toHaveCount(8)
    const other = await secondClient(browser, {})
    try {
      const project = await webProject(other.page)
      await api(other.page, `/projects/${project.id}/modules`, { method: 'POST', data: { title: 'Платежи' } })
      await expect(rows(page)).toHaveCount(9, LIVE)
      await expect(rows(page).first()).toContainText('Модуль «Платежи» создан')
    } finally {
      await other.close()
    }
  })

  test('страница вики, которую другой участник сохранил, обновляется, пока её просто читают', async ({ page, browser }) => {
    const id = await idOf(page, 'Начало работы')
    await openApp(page, { settings: { page: 'wiki', wikiPage: id } })
    await expect(page.getByLabel('Название страницы')).toBeVisible()
    const other = await secondClient(browser, {})
    try {
      const current = await wikiPage(other.page, id)
      await api(other.page, `/wiki/${id}`, { method: 'PATCH', data: { rev: current.rev, md: 'Новый абзац от соседа' } })
      await expect(page.locator('.md')).toContainText('Новый абзац от соседа', LIVE)
    } finally {
      await other.close()
    }
  })

  test('холст документа: объект, добавленный другим, появляется у того, кто смотрит', async ({ page, browser }) => {
    const id = await docId(page, 'Схема сервисов')
    await openApp(page, { settings: { page: 'docs', docOpen: id } })
    await expect(page.locator('.cv .wb-item')).toHaveCount(7)
    const other = await secondClient(browser, {})
    try {
      const doc = await docFull(other.page, id)
      const extra: DocObject = { ...doc.objects[0]!, id: crypto.randomUUID(), x: doc.objects[0]!.x + 60, y: doc.objects[0]!.y + 90, text: 'Добавлено соседом' }
      await api(other.page, `/docs/${id}/canvas`, { method: 'PUT', data: { note: doc.note, objects: [...doc.objects, extra], links: doc.links } })
      await expect(page.locator('.cv .wb-item')).toHaveCount(8, LIVE)
      await expect(page.locator('.cv')).toContainText('Добавлено соседом')
    } finally {
      await other.close()
    }
  })
})

// ===== Набираемый текст не пропадает =====

test.describe('чужая правка не стирает то, что человек печатает', () => {
  const titleInput = (page: Page) => drawer(page).getByRole('textbox', { name: 'Название задачи' })

  async function openTask(page: Page) {
    await card(page, 'WEB-144').getByRole('button', { name: 'Вход через SSO для корпоративных аккаунтов' }).click()
    await expect(titleInput(page)).toHaveValue('Вход через SSO для корпоративных аккаунтов')
  }

  test('поле, в котором ничего не меняли, берёт чужое название', async ({ page, browser }) => {
    await openApp(page)
    const other = await secondClient(browser, {})
    try {
      await openTask(page)
      const task = (await webBoard(other.page)).tasks.find((t) => t.key === 'WEB-144')!
      await api(other.page, `/tasks/${task.id}`, { method: 'PATCH', data: { title: 'Название от соседа' } })
      await expect(titleInput(page)).toHaveValue('Название от соседа', LIVE)
      await expect(card(page, 'WEB-144')).toContainText('Название от соседа')
    } finally {
      await other.close()
    }
  })

  test('если человек уже печатает в поле, его текст остаётся и сохраняется по выходу из поля', async ({ page, browser }) => {
    await openApp(page)
    const other = await secondClient(browser, {})
    try {
      await openTask(page)
      await titleInput(page).click()
      await page.keyboard.press('End')
      await page.keyboard.type(' (дополнено)')

      const task = (await webBoard(other.page)).tasks.find((t) => t.key === 'WEB-144')!
      await api(other.page, `/tasks/${task.id}`, { method: 'PATCH', data: { title: 'Название от соседа' } })
      // карточка на доске уже показывает чужое название, значит, обновление дошло, а поле его не тронуло
      await expect(card(page, 'WEB-144')).toContainText('Название от соседа', LIVE)
      await expect(titleInput(page)).toHaveValue('Вход через SSO для корпоративных аккаунтов (дополнено)')

      await titleInput(page).press('Enter')
      await expect.poll(async () => (await webBoard(other.page)).tasks.find((t) => t.key === 'WEB-144')!.title).toBe('Вход через SSO для корпоративных аккаунтов (дополнено)')
    } finally {
      await other.close()
    }
  })
})

// ===== Лишних запросов нет =====

test.describe('без лишних перезапросов', () => {
  test('своё действие перечитывает данные один раз, а не дважды: собственное событие пропускается', async ({ page, browser }) => {
    await openApp(page, { settings: { page: 'links' } })
    const other = await secondClient(browser, { page: 'links' })
    try {
      await expect(sections(other.page)).toHaveCount(4)
      const mine = countGets(page, '/api/v1/link-groups')
      const theirs = countGets(other.page, '/api/v1/link-groups')

      await page.getByLabel('Название новой группы', { exact: true }).fill('Одна группа')
      await page.getByLabel('Название новой группы', { exact: true }).press('Enter')
      await expect(sections(other.page)).toHaveCount(5, LIVE)
      await page.waitForTimeout(1500) // если бы своё событие не пропускалось, второй запрос уже был бы

      expect(mine.hits, 'у того, кто сделал: только перечитывание после своего запроса').toHaveLength(1)
      expect(theirs.hits, 'у другого окна: ровно одно перечитывание').toHaveLength(1)
    } finally {
      await other.close()
    }
  })

  test('одно действие даёт несколько событий, а доска перечитывается один раз', async ({ page, browser }) => {
    await openApp(page)
    const other = await secondClient(browser, {})
    try {
      const requests = countGets(other.page, '/board')
      const project = await webProject(page)
      const first = (await webBoard(page)).columns.find((c) => c.title === 'К выполнению')!
      // создание задачи: события task.created и activity.created
      await api(page, `/projects/${project.id}/tasks`, { method: 'POST', data: { title: 'Новая от соседа', column_id: first.id } })
      await expect(other.page.locator('[data-card-id]')).toHaveCount(13, LIVE)
      await other.page.waitForTimeout(800)
      expect(requests.hits).toHaveLength(1)
    } finally {
      await other.close()
    }
  })

  test('пока человек тащит карточку, доска не перечитывается; чужое изменение дожидается броска', async ({ page, browser }) => {
    await openApp(page)
    const other = await secondClient(browser, {})
    try {
      const board = await webBoard(page)
      const target = board.tasks.find((t) => t.key === 'WEB-126')!
      const requests = countGets(page, '/board')

      // берём карточку и держим её над доской
      const box = (await card(page, 'WEB-151').boundingBox())!
      await page.mouse.move(box.x + 40, box.y + 30)
      await page.mouse.down()
      await page.mouse.move(box.x + 60, box.y + 60, { steps: 4 })
      await page.mouse.move(box.x + 300, box.y + 80, { steps: 8 })

      await api(other.page, `/tasks/${target.id}`, { method: 'PATCH', data: { title: 'Переименована соседом' } })
      await page.waitForTimeout(1500)
      expect(requests.hits, 'во время переноса запросов нет').toHaveLength(0)
      await expect(card(page, 'WEB-126')).not.toContainText('Переименована соседом')

      await page.keyboard.press('Escape')
      await page.mouse.up()
      await expect(card(page, 'WEB-126')).toContainText('Переименована соседом', { timeout: 4000 })
    } finally {
      await other.close()
    }
  })
})

// ===== Обрыв связи =====

test.describe('обрыв связи', () => {
  /** Сокет страницы под нашим управлением: можно оборвать и не пускать обратно */
  async function controlled(page: Page) {
    const control = { attempts: 0, blocked: false, live: [] as Array<{ close: (o?: { code?: number }) => void }>, closed: 0 }
    await page.routeWebSocket(/\/api\/v1\/ws$/, (ws) => {
      control.attempts++
      if (control.blocked) {
        ws.close({ code: 3000 })
        return
      }
      ws.connectToServer()
      control.live.push(ws)
      ws.onClose(() => control.closed++)
    })
    return control
  }

  test('связь оборвалась: точка краснеет, клиент подключается снова и перечитывает то, что пропустил', async ({ page, browser }) => {
    const control = await controlled(page)
    await openApp(page, { settings: { page: 'links' } })
    await expect(dot(page)).toHaveAttribute('data-connection', 'open')
    await expect(sections(page)).toHaveCount(4)
    expect(control.attempts).toBe(1)

    control.blocked = true
    control.live.at(-1)!.close({ code: 3000 })
    await expect(dot(page)).toHaveAttribute('data-connection', 'offline')

    // пока связи нет, другой участник добавляет группу: событие мимо этого клиента
    await api(page, '/link-groups', { method: 'POST', data: { title: 'Пока вас не было' } })
    await page.waitForTimeout(1200)
    await expect(sections(page)).toHaveCount(4)
    expect(control.attempts, 'клиент уже пытался подключиться, паузы растут').toBeGreaterThan(1)

    control.blocked = false
    await expect(dot(page)).toHaveAttribute('data-connection', 'open', { timeout: 10_000 })
    await expect(sections(page)).toHaveCount(5, { timeout: 3000 })
    await expect(groupTitles(page).last()).toHaveValue('Пока вас не было')
  })

  test('после возвращения связи изменения снова приходят сразу', async ({ page }) => {
    const control = await controlled(page)
    await openApp(page, { settings: { page: 'links' } })
    await expect(dot(page)).toHaveAttribute('data-connection', 'open')
    control.live.at(-1)!.close({ code: 3000 })
    await expect(dot(page)).toHaveAttribute('data-connection', 'offline')
    await expect(dot(page)).toHaveAttribute('data-connection', 'open', { timeout: 6000 }) // подключился заново (первая пауза около секунды)
    expect(control.attempts).toBe(2)

    await api(page, '/link-groups', { method: 'POST', data: { title: 'После обрыва' } })
    await expect(sections(page)).toHaveCount(5, LIVE)
  })

  test('выход из приложения закрывает связь, и клиент больше не стучится', async ({ page }) => {
    const control = await controlled(page)
    await openApp(page)
    await expect(dot(page)).toHaveAttribute('data-connection', 'open')
    await page.getByRole('button', { name: /Лена М\./ }).click()
    await page.getByRole('menuitem', { name: 'Выйти' }).click()
    await expect(page.getByRole('heading', { name: /Вход|E-mail/ }).first()).toBeVisible()
    await expect.poll(() => control.closed).toBe(1)
    await page.waitForTimeout(3500)
    expect(control.attempts).toBe(1)
  })

  test('сервер не принял вход (токен испорчен): клиент не зацикливается, а ждёт с нарастающей паузой', async ({ page }) => {
    let attempts = 0
    await page.routeWebSocket(/\/api\/v1\/ws$/, (ws) => {
      attempts++
      ws.onMessage(() => {
        ws.send(JSON.stringify({ type: 'error', code: 'unauthorized' }))
        ws.close({ code: 4401 })
      })
    })
    await openApp(page)
    await expect(dot(page)).toHaveAttribute('data-connection', /offline|connecting/)
    await page.waitForTimeout(3000)
    // три быстрых попытки с обновлением токена, дальше пауза в секунды: сотни подключений не будет
    expect(attempts).toBeGreaterThanOrEqual(2)
    expect(attempts).toBeLessThan(8)
  })
})

// ===== Не те адреса =====

test('адрес сервера не меняется от живых обновлений: запросы идут на тот же сервер', async ({ page }) => {
  const sockets: string[] = []
  // сокет сервера разработки (Vite) не считаем: он про горячую перезагрузку страницы
  page.on('websocket', (ws) => ws.url().includes('/api/v1/ws') && sockets.push(ws.url()))
  await openApp(page)
  await expect(dot(page)).toHaveAttribute('data-connection', 'open')
  expect(sockets).toEqual([`${SERVER.replace('http', 'ws')}/api/v1/ws`])
  await expect(nav(page, 'Доска')).toBeVisible()
})
