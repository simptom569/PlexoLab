import { expect, test, type Page } from '@playwright/test'
import { compareToReference, type Rect } from './compare'
import { openApp, resetData, SERVER } from './fixtures'
import { textRects } from './helpers'
import { MAX_DIFF_RATIO } from './tolerance'

const MAIN: Rect = { x: 233, y: 0, width: 1207, height: 900 }

/** Плавающую копию под указателем в эталонах нет (её рисует браузер), поэтому на снимке прячем */
const HIDE_OVERLAY = '.drag-overlay{visibility:hidden}'

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

async function compare(page: Page, file: string, name: string) {
  await page.addStyleTag({ content: HIDE_OVERLAY })
  const actual = await page.screenshot({ clip: MAIN })
  const text = await textRects(page, MAIN)
  const { diffPixels, total, diffRatio } = compareToReference({ actual, referenceFile: file, region: MAIN, ignore: text, name })
  console.log(`  ${name}: отличается ${diffPixels} из ${total} (${(diffRatio * 100).toFixed(3)}%)`)
  expect(diffRatio).toBeLessThan(MAX_DIFF_RATIO)
}

type Board = {
  columns: Array<{ id: string; title: string; position: number }>
  tasks: Array<{ key: string; column_id: string | null; due_date: string | null; position: number }>
}

async function boardOnServer(page: Page, project = 'Web-приложение'): Promise<Board> {
  const login = await page.request.post(`${SERVER}/api/v1/auth/login`, { data: { email: 'lena@example.com', password: 'dev' } })
  const { access_token } = (await login.json()) as { access_token: string }
  const headers = { Authorization: `Bearer ${access_token}` }
  const projects = (await (await page.request.get(`${SERVER}/api/v1/projects`, { headers })).json()) as Array<{ id: string; name: string }>
  const id = projects.find((p) => p.name === project)!.id
  return (await (await page.request.get(`${SERVER}/api/v1/projects/${id}/board`, { headers })).json()) as Board
}

test.beforeEach(() => resetData())

for (const theme of ['light', 'dark'] as const) {
  test.describe(`перенос, ${theme}`, () => {
    test(`20: карточка WEB-151 над колонкой «На ревью» (${theme})`, async ({ page }) => {
      await openApp(page, { theme })
      const from = await center(page, '[data-card-id]:has-text("WEB-151")')
      const target = await center(page, '[data-card-id]:has-text("WEB-137")')
      await dragTo(page, from, { x: target.x, y: target.box.y + 20 })
      await compare(page, `20-drag-card-${theme}.png`, `20-drag-card-${theme}`)
      await page.keyboard.press('Escape')
      await page.mouse.up()
    })

    test(`21: колонка «Готово» перед «На ревью» (${theme})`, async ({ page }) => {
      await openApp(page, { theme })
      const grip = await center(page, '[data-col-id]:has(h2:text-is("Готово")) .col-head .grip')
      const target = await center(page, '[data-col-id]:has(h2:text-is("На ревью"))')
      await dragTo(page, grip, { x: target.box.x + 40, y: target.box.y + 30 })
      await compare(page, `21-drag-column-${theme}.png`, `21-drag-column-${theme}`)
      await page.keyboard.press('Escape')
      await page.mouse.up()
    })

    test(`23: плашка в календаре над 15 октября (${theme})`, async ({ page }) => {
      await openApp(page, { theme, settings: { view: 'cal' } })
      const from = await center(page, '.cal-pill:has-text("Обновить мета-теги")')
      const target = await center(page, '.cal-cell:has(.cal-num:text-is("15"):not(.out))')
      await dragTo(page, from, target)
      await compare(page, `23-drag-calendar-${theme}.png`, `23-drag-calendar-${theme}`)
      await page.keyboard.press('Escape')
      await page.mouse.up()
    })
  })
}

test.describe('бросок меняет данные на сервере', () => {
  test('карточка в другую колонку', async ({ page }) => {
    await openApp(page)
    const from = await center(page, '[data-card-id]:has-text("WEB-151")')
    const target = await center(page, '[data-card-id]:has-text("WEB-137")')
    await dragTo(page, from, { x: target.x, y: target.box.y + 20 })
    await page.mouse.up()
    await expect(page.locator('[data-col-id]:has(h2:text-is("На ревью")) [data-card-id]')).toHaveText([/WEB-141/, /WEB-151/, /WEB-137/])
    await expect(page.locator('[data-col-id]:has(h2:text-is("К выполнению")) .count')).toHaveText('2')
    await expect
      .poll(async () => {
        const b = await boardOnServer(page)
        const review = b.columns.find((c) => c.title === 'На ревью')!.id
        return b.tasks.filter((t) => t.column_id === review).sort((x, y) => x.position - y.position).map((t) => t.key)
      })
      .toEqual(['WEB-141', 'WEB-151', 'WEB-137'])
  })

  test('колонка на новое место, порядок сохраняется после перезагрузки', async ({ page }) => {
    await openApp(page)
    const grip = await center(page, '[data-col-id]:has(h2:text-is("Готово")) .col-head .grip')
    const target = await center(page, '[data-col-id]:has(h2:text-is("На ревью"))')
    await dragTo(page, grip, { x: target.box.x + 40, y: target.box.y + 30 })
    await page.mouse.up()
    await expect(page.locator('.col h2')).toHaveText(['К выполнению', 'В работе', 'Готово', 'На ревью'])
    await expect
      .poll(async () => (await boardOnServer(page)).columns.sort((a, b) => a.position - b.position).map((c) => c.title))
      .toEqual(['К выполнению', 'В работе', 'Готово', 'На ревью'])
    await page.reload()
    await expect(page.locator('.col h2')).toHaveText(['К выполнению', 'В работе', 'Готово', 'На ревью'])
  })

  test('плашка на другой день меняет срок', async ({ page }) => {
    await openApp(page, { settings: { view: 'cal' } })
    const from = await center(page, '.cal-pill:has-text("Обновить мета-теги")')
    const target = await center(page, '.cal-cell:has(.cal-num:text-is("15"):not(.out))')
    await dragTo(page, from, target)
    await page.mouse.up()
    await expect(page.locator('.cal-cell:has(.cal-num:text-is("15")) .cal-pill')).toHaveText(/Обновить мета-теги/)
    await expect.poll(async () => (await boardOnServer(page)).tasks.find((t) => t.key === 'WEB-126')?.due_date).toBe('2026-10-15')
  })

  test('возврат карточки на то же место ничего не меняет', async ({ page }) => {
    await openApp(page)
    const requests: string[] = []
    page.on('request', (r) => r.method() === 'PATCH' && requests.push(r.url()))
    const from = await center(page, '[data-card-id]:has-text("WEB-149")')
    const target = await center(page, '[data-card-id]:has-text("WEB-153")')
    // верхняя половина следующей карточки: место прямо перед WEB-153, то есть то же, где стоит WEB-149
    await dragTo(page, from, { x: target.x, y: target.box.y + 20 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    expect(requests).toEqual([])
    await expect(page.locator('[data-col-id]:has(h2:text-is("К выполнению")) [data-card-id]')).toHaveText([/WEB-151/, /WEB-149/, /WEB-153/])
  })

  test('отпустили не над целью: ничего не происходит', async ({ page }) => {
    await openApp(page)
    const requests: string[] = []
    page.on('request', (r) => r.method() === 'PATCH' && requests.push(r.url()))
    const from = await center(page, '[data-card-id]:has-text("WEB-151")')
    await dragTo(page, from, { x: 600, y: 120 }) // шапка страницы, не колонка
    await page.mouse.up()
    await page.waitForTimeout(300)
    expect(requests).toEqual([])
  })
})
