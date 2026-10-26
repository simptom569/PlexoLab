import { expect, test, type Page } from '@playwright/test'
import { docFull, makeDoc, openDoc } from './docs-helpers'
import { openApp, resetData } from './fixtures'
import { api, blocks, editor, expectSaved, makePage, openPageById, wikiPage } from './wiki-helpers'

// Нет связи с сервером (lib/link.ts, docs/OFFLINE-NOTIFY-SEARCH.md, раздел 1): через три секунды сверху полоска «Нет связи»,
// правки закрыты, загруженное остаётся на экране, а неотправленный текст не теряется и уходит, когда связь вернулась.
// Связь обрывается средствами браузера (`context.setOffline`): запросы самого теста к серверу (`page.request`) идут как обычно,
// так что «другой человек» может править, пока у первого связи нет.

test.beforeEach(() => resetData())

const bar = (page: Page) => page.getByRole('status').filter({ hasText: 'Нет связи с сервером' })
const card = (page: Page, key: string) => page.locator('[data-card-id]', { hasText: key })
const column = (page: Page, title: string) => page.locator('.col', { has: page.locator('h2', { hasText: new RegExp(`^${title}$`) }) })
const drawer = (page: Page) => page.getByRole('dialog', { name: /^Задача / })

/** Связь пропала; полоска появится через три секунды */
async function cutOff(page: Page) {
  await page.context().setOffline(true)
}

/** Связь пропала и «просмотр» включился */
async function cutOffAndWait(page: Page) {
  await cutOff(page)
  await expect(bar(page)).toBeVisible({ timeout: 8000 })
}

async function restore(page: Page) {
  await page.context().setOffline(false)
}

/** Просит клиент перечитать все данные (как это делает сам клиент, когда приходит чужое изменение) */
async function refetchAll(page: Page) {
  await page.evaluate(async () => {
    const path = '/src/lib/query.ts'
    const { queryClient } = await import(/* @vite-ignore */ path)
    await queryClient.invalidateQueries()
  })
}

type Project = { id: string; key: string }
const webProject = async (page: Page) => (await api<Project[]>(page, '/projects')).find((p) => p.key === 'WEB')!
type BoardTask = { id: string; key: string; title: string; column_id: string | null }
const webBoard = async (page: Page) =>
  api<{ tasks: BoardTask[]; columns: Array<{ id: string; title: string }> }>(page, `/projects/${(await webProject(page)).id}/board`)

test.describe('режим «только просмотр»', () => {
  test('связи нет три секунды: появляется полоска, экран и данные остаются на месте', async ({ page }) => {
    await openApp(page)
    await expect(card(page, 'WEB-141')).toBeVisible()
    await expect(bar(page)).toHaveCount(0)

    await cutOff(page)
    await page.waitForTimeout(1000)
    await expect(bar(page)).toHaveCount(0) // короткий сбой блокировкой не мигает
    await expect(bar(page)).toBeVisible({ timeout: 5000 })
    await expect(bar(page)).toHaveText('Нет связи с сервером. Можно читать, править получится, когда связь вернётся.')

    // фоновое обновление не удаётся, а доска остаётся: ни входа, ни «Не удалось загрузить»
    await refetchAll(page)
    await page.waitForTimeout(4500) // два повтора запроса (1 и 2 секунды), потом ошибка
    await expect(card(page, 'WEB-141')).toBeVisible()
    await expect(page.getByText('Не удалось загрузить')).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Новая задача' })).toBeDisabled()

    await restore(page)
    await expect(bar(page)).toHaveCount(0, { timeout: 8000 })
    await expect(page.getByRole('button', { name: 'Новая задача' })).toBeEnabled()
  })

  test('когда связь вернулась, чужие изменения подтягиваются сами', async ({ page }) => {
    await openApp(page)
    await expect(card(page, 'WEB-141')).toBeVisible()
    await cutOffAndWait(page)

    const { tasks } = await webBoard(page)
    const task = tasks.find((t) => t.key === 'WEB-141')!
    await api(page, `/tasks/${task.id}`, { method: 'PATCH', data: { title: 'Переименовано без нас' } })
    await expect(card(page, 'WEB-141')).not.toContainText('Переименовано без нас')

    await restore(page)
    await expect(card(page, 'WEB-141')).toContainText('Переименовано без нас', { timeout: 8000 })
    await expect(bar(page)).toHaveCount(0)
  })

  test('карточку нельзя перенести: на сервере ничего не меняется', async ({ page }) => {
    await openApp(page)
    await expect(card(page, 'WEB-141')).toBeVisible()
    const before = await webBoard(page)
    const task = before.tasks.find((t) => t.key === 'WEB-141')!
    await cutOffAndWait(page)

    const from = (await card(page, 'WEB-141').boundingBox())!
    const to = (await column(page, 'Готово').boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + 20)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + 120, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(300)

    const after = await webBoard(page)
    expect(after.tasks.find((t) => t.id === task.id)!.column_id).toBe(task.column_id)
    // карточка даже не поднялась: ни запроса, ни отказа записи (его плашка «сейчас можно только смотреть»)
    await expect(page.getByText('Не удалось сохранить')).toHaveCount(0)
    await expect(page.getByText('сейчас можно только смотреть')).toHaveCount(0)
  })

  test('в панели задачи поля только для чтения, кнопки записи закрыты, читать можно', async ({ page }) => {
    await openApp(page)
    await card(page, 'WEB-141').locator('.card-title').click()
    await expect(drawer(page)).toBeVisible()
    await cutOffAndWait(page)

    await expect(drawer(page).getByLabel('Название задачи')).toHaveAttribute('readonly', '')
    await expect(drawer(page).getByLabel('Описание')).toHaveAttribute('readonly', '')
    await expect(drawer(page).getByLabel('Комментарий')).toHaveAttribute('readonly', '')
    await expect(drawer(page).getByLabel('Новая подзадача')).toHaveAttribute('readonly', '')
    await expect(drawer(page).getByRole('button', { name: 'Отправить' })).toBeDisabled()
    await expect(drawer(page).getByRole('button', { name: /Отметить выполненной|Выполнена/ })).toBeDisabled()
    await expect(drawer(page).getByRole('button', { name: 'Удалить', exact: true })).toBeDisabled()
    await expect(drawer(page).getByRole('button', { name: 'Низкий' })).toBeDisabled()
    await expect(drawer(page).locator('input[type=file]')).toBeDisabled()
    // а панель закрывается: это чтение
    await drawer(page).getByRole('button', { name: 'Закрыть', exact: true }).click()
    await expect(drawer(page)).toHaveCount(0)
  })

  test('вики: страница на экране, блок не открывается на правку, «+», панель и название закрыты', async ({ page }) => {
    const id = await makePage(page, 'Для чтения', 'Первый абзац\n\n- [ ] пункт')
    await openPageById(page, id)
    await expect(blocks(page).first()).toBeVisible()
    await cutOffAndWait(page)

    await blocks(page).first().click()
    await expect(editor(page)).toHaveCount(0)
    await expect(page.locator('.md-add')).toHaveCount(0)
    await expect(page.locator('.md-gap')).toHaveCount(0)
    await expect(page.locator('.md-tool').first()).toBeDisabled()
    await expect(page.getByLabel('Название страницы')).toHaveAttribute('readonly', '')
    await expect(page.getByRole('button', { name: 'Отметить пункт' })).toBeDisabled()
    await expect(page.getByText('Не удалось загрузить страницу')).toHaveCount(0)
    expect((await wikiPage(page, id)).md).toBe('Первый абзац\n\n- [ ] пункт')
  })

  test('документ: холст читается, инструменты и режим закрыты', async ({ page }) => {
    const id = await makeDoc(page, 'Схема', 'edge', 'Текст')
    await openDoc(page, id)
    await expect(page.getByLabel('Название документа')).toBeVisible()
    await cutOffAndWait(page)

    await expect(page.getByLabel('Название документа')).toHaveAttribute('readonly', '')
    for (const tool of await page.locator('.eg-tools button').all()) await expect(tool).toBeDisabled()
    await expect(page.getByRole('group', { name: 'Режим документа' }).getByRole('button').first()).toBeDisabled()
    // масштаб и «Показать всё» относятся к просмотру и работают
    await expect(page.getByRole('button', { name: 'Показать всё' })).toBeEnabled()
    await expect(page.getByText('Не удалось загрузить документ')).toHaveCount(0)
    expect((await docFull(page, id)).md).toBe('Текст')
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`полоска собрана из переменных темы (${theme}) и закреплена над содержимым`, async ({ page }) => {
      await openApp(page, { theme })
      await expect(card(page, 'WEB-141')).toBeVisible()
      await cutOffAndWait(page)
      await expect(bar(page)).toHaveCSS('background-color', theme === 'light' ? 'rgb(253, 231, 218)' : 'rgb(58, 34, 24)') // --bug-bg
      await expect(bar(page)).toHaveCSS('color', theme === 'light' ? 'rgb(154, 52, 18)' : 'rgb(255, 180, 138)') // --bug-fg
      await page.mouse.move(700, 500)
      await expect(page).toHaveScreenshot(`offline-bar-${theme}.png`, { clip: { x: 232, y: 0, width: 1208, height: 220 } })
    })
  }
})

test.describe('неотправленный текст не теряется', () => {
  test('вики: набрал, связи не стало, ушёл со страницы; когда связь вернулась, текст на сервере, плашки об ошибке не было', async ({ page }) => {
    const id = await makePage(page, 'Не потерять', 'Первый абзац\n\nВторой абзац')
    await openPageById(page, id)
    await expect(blocks(page).first()).toBeVisible()

    await cutOff(page)
    await blocks(page).nth(1).click()
    await page.keyboard.type(' (набрано без связи)')
    await page.keyboard.press('Escape') // закончил блок: сохранение пробует уйти и не может
    await expect(bar(page)).toBeVisible({ timeout: 8000 })
    await expect(bar(page)).toContainText('Неотправленные правки сохранены и уйдут сами.')

    // ушёл на доску (это чтение, она уже загружена): черновик живёт и без экрана страницы
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: /^Доска/ }).click()
    await expect(card(page, 'WEB-141')).toBeVisible()
    expect((await wikiPage(page, id)).md).toBe('Первый абзац\n\nВторой абзац')

    await restore(page)
    await expectSaved(page, id, 'Первый абзац\n\nВторой абзац (набрано без связи)')
    await expect(bar(page)).toHaveCount(0)
    await expect(page.getByText(/Не удалось сохранить/)).toHaveCount(0) // за всё время ни одной плашки
  })

  test('документ: название и текст, набранные до обрыва, уходят после возвращения связи', async ({ page }) => {
    const id = await makeDoc(page, 'Черновик', 'page', 'Первый абзац')
    await openDoc(page, id)
    await expect(blocks(page).first()).toBeVisible()

    await cutOff(page)
    await page.getByLabel('Название документа').fill('Черновик, переименован без связи')
    await blocks(page).first().click()
    await page.keyboard.type(' (без связи)')
    await page.keyboard.press('Escape')
    await expect(bar(page)).toContainText('Неотправленные правки сохранены и уйдут сами.', { timeout: 8000 })

    await restore(page)
    await expect.poll(async () => (await docFull(page, id)).md, { timeout: 10_000 }).toBe('Первый абзац (без связи)')
    expect((await docFull(page, id)).title).toBe('Черновик, переименован без связи')
    await expect(bar(page)).toHaveCount(0)
    await expect(page.getByText(/Не удалось сохранить/)).toHaveCount(0)
  })

  test('короткий сбой связи (меньше трёх секунд) ничего не блокирует и текст уходит сразу', async ({ page }) => {
    const id = await makePage(page, 'Короткий сбой', 'Первый абзац')
    await openPageById(page, id)
    await expect(blocks(page).first()).toBeVisible()

    await cutOff(page)
    await blocks(page).first().click()
    await page.keyboard.type(' (ещё)')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    await restore(page) // не прошло и секунды: полоски не было
    await expect(bar(page)).toHaveCount(0)
    await expectSaved(page, id, 'Первый абзац (ещё)')
  })
})
