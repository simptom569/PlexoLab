import { expect, test, type Page } from '@playwright/test'
import { docFull, docSummaries, makeDoc, openDoc } from './docs-helpers'
import { openApp, resetData } from './fixtures'
import { bar, card, cutOff, nav, restore } from './offline-helpers'
import { api, blocks, expectSaved, makePage, openPageById, wikiNodes, wikiPage } from './wiki-helpers'

// Этап Н2 (docs/OFFLINE-NOTIFY-SEARCH.md, разделы 1.3 и 1.4): правки человека, который ушёл со страницы, а потом выяснилось,
// что их не слить с чужими, сохраняются отдельной страницей (документом) рядом; закрытие окна с неотправленным текстом
// не молчит. Обрыв связи делается средствами браузера, «другой человек» правит через `api()` (запросы теста идут как обычно).

test.beforeEach(() => resetData())

const COPY_SUFFIX = /\(правки Лена М\., \d\d\.\d\d \d\d:\d\d\)$/
const THREE = 'Первый абзац\n\nВторой абзац'

/** Страница или документ, на которых человек правит первый абзац без связи, после чего уходит на доску */
async function typeOfflineAndLeave(page: Page, text: string) {
  await cutOff(page)
  await blocks(page).first().click()
  await page.keyboard.type(text)
  await page.keyboard.press('Escape') // закончил блок: сохранение пробует уйти и не может
  await expect(bar(page)).toContainText('Неотправленные правки сохранены и уйдут сами.', { timeout: 8000 })
  await nav(page, /^Доска/).click()
  await expect(card(page, 'WEB-141')).toBeVisible()
}

test.describe('копия рядом при конфликте', () => {
  test('вики: правки ушедшего человека лежат отдельной страницей сразу после оригинала, оригинал с чужой версией', async ({ page }) => {
    const id = await makePage(page, 'Спорная', THREE)
    const next = await makePage(page, 'Соседняя после', 'Текст')
    await openPageById(page, id)
    await expect(blocks(page).first()).toBeVisible()
    await typeOfflineAndLeave(page, ' (я)')

    // пока связи нет, другой человек правит ту же строку
    const current = await wikiPage(page, id)
    await api(page, `/wiki/${id}`, { method: 'PATCH', data: { rev: current.rev, md: 'Первый абзац (чужой)\n\nВторой абзац' } })

    await restore(page)
    await expect.poll(async () => (await wikiNodes(page)).filter((n) => n.title.startsWith('Спорная (правки')).length, { timeout: 10_000 }).toBe(1)

    const nodes = await wikiNodes(page)
    const original = nodes.find((n) => n.id === id)!
    const copy = nodes.find((n) => n.title.startsWith('Спорная (правки'))!
    const after = nodes.find((n) => n.id === next)!
    expect(copy.title).toMatch(COPY_SUFFIX)
    expect((await wikiPage(page, copy.id)).md).toBe('Первый абзац (я)\n\nВторой абзац') // мои правки целиком
    expect((await wikiPage(page, id)).md).toBe('Первый абзац (чужой)\n\nВторой абзац') // оригинал остался чужим
    expect(copy.parent_id ?? null).toBe(original.parent_id ?? null)
    expect(copy.position).toBeGreaterThan(original.position) // сразу после оригинала, до того, что шло за ним
    expect(copy.position).toBeLessThan(after.position)

    await expect(page.getByText('они сохранены отдельной страницей «Спорная (правки')).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(bar(page)).toHaveCount(0)
  })

  test('документ: то же самое, в том же проекте и в том же режиме', async ({ page }) => {
    const id = await makeDoc(page, 'Спорный', 'page', THREE)
    await openDoc(page, id)
    await expect(blocks(page).first()).toBeVisible()
    await typeOfflineAndLeave(page, ' (я)')

    const current = await docFull(page, id)
    await api(page, `/docs/${id}`, { method: 'PATCH', data: { rev: current.rev, md: 'Первый абзац (чужой)\n\nВторой абзац' } })

    await restore(page)
    await expect.poll(async () => (await docSummaries(page)).filter((d) => d.title.startsWith('Спорный (правки')).length, { timeout: 10_000 }).toBe(1)

    const list = await docSummaries(page)
    const original = list.find((d) => d.id === id)!
    const copy = list.find((d) => d.title.startsWith('Спорный (правки'))!
    expect(copy.title).toMatch(COPY_SUFFIX)
    expect(copy.mode).toBe('page')
    expect((await docFull(page, copy.id)).md).toBe('Первый абзац (я)\n\nВторой абзац')
    expect((await docFull(page, id)).md).toBe('Первый абзац (чужой)\n\nВторой абзац')
    // сразу после оригинала: следующий за ним в списке
    const order = list.map((d) => d.id)
    expect(order.indexOf(copy.id)).toBe(order.indexOf(original.id) + 1)
    await expect(page.getByText('они сохранены отдельным документом «Спорный (правки')).toBeVisible()
  })

  test('человек остался на странице: копии нет, прежний баннер с выбором', async ({ page }) => {
    const id = await makePage(page, 'Остался', THREE)
    // «слепое» окно: чужие правки не приходят вживую, поэтому конфликт настоящий
    await openApp(page, { settings: { page: 'wiki', wikiPage: id, live: false } })
    await expect(page.getByLabel('Название страницы')).toBeVisible()
    const current = await wikiPage(page, id)
    await api(page, `/wiki/${id}`, { method: 'PATCH', data: { rev: current.rev, md: 'Первый абзац (чужой)\n\nВторой абзац' } })

    await blocks(page).first().click()
    await page.keyboard.type(' (я)')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('alert')).toContainText('Страницу изменил другой участник')
    await page.waitForTimeout(2000)
    expect((await wikiNodes(page)).filter((n) => n.title.startsWith('Остался (')).length).toBe(0)
    await expect(page.getByRole('alert')).toBeVisible()
  })

  test('разошлись только названия: копии нет, остаётся чужое название', async ({ page }) => {
    const id = await makePage(page, 'Общее название', THREE)
    await openPageById(page, id)
    const before = (await wikiNodes(page)).length

    await cutOff(page)
    await page.getByLabel('Название страницы').fill('Моё название')
    await page.waitForTimeout(900) // автосохранение пробует уйти и не может
    await expect(bar(page)).toBeVisible({ timeout: 8000 })
    await nav(page, /^Доска/).click()
    await expect(card(page, 'WEB-141')).toBeVisible()

    const current = await wikiPage(page, id)
    await api(page, `/wiki/${id}`, { method: 'PATCH', data: { rev: current.rev, title: 'Чужое название' } })

    await restore(page)
    await page.waitForTimeout(2500)
    const nodes = await wikiNodes(page)
    expect(nodes).toHaveLength(before) // новых страниц нет
    expect(nodes.find((n) => n.id === id)!.title).toBe('Чужое название')
    expect((await wikiPage(page, id)).md).toBe(THREE)
  })

  test('правки в разных местах по-прежнему сливаются тихо, без копии', async ({ page }) => {
    const id = await makePage(page, 'Слить', THREE)
    await openPageById(page, id)
    await expect(blocks(page).first()).toBeVisible()
    await typeOfflineAndLeave(page, ' (я)')

    const current = await wikiPage(page, id)
    await api(page, `/wiki/${id}`, { method: 'PATCH', data: { rev: current.rev, md: 'Первый абзац\n\nВторой абзац (чужой)' } })

    await restore(page)
    await expectSaved(page, id, 'Первый абзац (я)\n\nВторой абзац (чужой)')
    expect((await wikiNodes(page)).filter((n) => n.title.startsWith('Слить (')).length).toBe(0)
  })
})

test.describe('защита при закрытии окна', () => {
  test('с неотправленным текстом браузер спрашивает подтверждение, без него окно закрывается молча', async ({ page }) => {
    const id = await makePage(page, 'Закрыть', THREE)
    await openPageById(page, id)
    await expect(blocks(page).first()).toBeVisible()

    const dialogs: string[] = []
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.type())
      await dialog.dismiss() // «Остаться»
    })

    await cutOff(page)
    await blocks(page).first().click()
    await page.keyboard.type(' (не ушло)')
    await page.keyboard.press('Escape')
    await expect(bar(page)).toContainText('Неотправленные правки сохранены и уйдут сами.', { timeout: 8000 })

    await page.close({ runBeforeUnload: true })
    await expect.poll(() => dialogs).toEqual(['beforeunload']) // вопрос приходит чуть позже, чем возвращается close
    expect(page.isClosed()).toBe(false) // человек остался

    await restore(page)
    await expectSaved(page, id, 'Первый абзац (не ушло)\n\nВторой абзац')
    await expect(bar(page)).toHaveCount(0)
    await page.close({ runBeforeUnload: true }) // теперь терять нечего
    await expect.poll(() => page.isClosed()).toBe(true)
    expect(dialogs).toEqual(['beforeunload']) // второго вопроса не было
  })

  /** Показывает вопрос при закрытии приложения, как это делает защита в окне Tauri, и запоминает ответ в `window` */
  async function askClose(page: Page) {
    await page.evaluate(async () => {
      const path = '/src/lib/closeAsk.ts'
      const { useCloseAsk } = await import(/* @vite-ignore */ path)
      const w = window as unknown as Record<string, unknown>
      w.__closeAnswer = 'нет ответа'
      void useCloseAsk.getState().ask().then((v: boolean) => (w.__closeAnswer = v))
    })
  }
  const answer = (page: Page) => page.evaluate(() => (window as unknown as Record<string, unknown>).__closeAnswer)
  const dialog = (page: Page) => page.getByRole('dialog', { name: 'Есть неотправленные правки' })

  test('вопрос при закрытии приложения: «Остаться», «Закрыть без отправки» и Esc', async ({ page }) => {
    await openApp(page)
    await expect(card(page, 'WEB-141')).toBeVisible()

    await askClose(page)
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page)).toContainText('Если закрыть приложение сейчас, она пропадёт.')
    await dialog(page).getByRole('button', { name: 'Остаться' }).click()
    await expect(dialog(page)).toHaveCount(0)
    expect(await answer(page)).toBe(false)

    await askClose(page)
    await dialog(page).getByRole('button', { name: 'Закрыть без отправки' }).click()
    expect(await answer(page)).toBe(true)

    await askClose(page)
    await expect(dialog(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    expect(await answer(page)).toBe(false) // закрыть окно вопроса значит «остаться»
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`окно вопроса при закрытии (${theme}) собрано из стилей окон приложения`, async ({ page }) => {
      await openApp(page, { theme })
      await expect(card(page, 'WEB-141')).toBeVisible()
      await askClose(page)
      await expect(dialog(page)).toBeVisible()
      await page.mouse.move(5, 5)
      await expect(page).toHaveScreenshot(`close-ask-${theme}.png`)
    })
  }
})
