// Перенос карточек документов по списку: заглушка на месте падения, как у задач (.ph), возврат на то же место, перенос при
// фильтре «Избранные», откат при отказе сервера. Порядок общий для команды и хранится на сервере.
// В макете такого переноса нет (просьба владельца), поэтому здесь только поведение, эталонного снимка нет.

import { expect, test, type Page } from '@playwright/test'
import { cardTitles, cards, docId, docSummaries, openDocs, orderOnServer } from './docs-helpers'
import { resetData } from './fixtures'
import { api } from './wiki-helpers'

test.beforeEach(() => resetData())

const ORDER = ['Схема сервисов', 'Планирование Q4', 'Идеи по онбордингу', 'Заметки со встречи 15 окт']
const card = (page: Page, title: string) => cards(page).filter({ has: page.getByText(title, { exact: true }) })
const placeholders = (page: Page) => page.locator('.dgrid .ph')

type Point = { x: number; y: number }

/** Точка внутри карточки: `fx` — доля ширины слева (0.2 — левая половина, 0.8 — правая) */
async function inCard(page: Page, title: string, fx: number, fy = 0.5): Promise<Point> {
  const box = await card(page, title).boundingBox()
  expect(box, `карточка «${title}»`).not.toBeNull()
  return { x: box!.x + box!.width * fx, y: box!.y + box!.height * fy }
}

/**
 * Берёт карточку мышью и ведёт к цели, не отпуская. Цель — функция: заглушка сдвигает карточки, и после первого
 * движения её положение надо измерить заново, пока указатель не окажется там, где задумано.
 */
async function grab(page: Page, title: string, target: () => Promise<Point>) {
  const from = await inCard(page, title, 0.5, 0.45)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 3 })
  let to = await target()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(120)
    const next = await target()
    if (Math.abs(next.x - to.x) < 1 && Math.abs(next.y - to.y) < 1) break
    to = next
    await page.mouse.move(to.x, to.y, { steps: 3 })
  }
}

const moveTo = (page: Page, p: Point) => page.mouse.move(p.x, p.y, { steps: 4 })

async function dragTo(page: Page, title: string, target: () => Promise<Point>) {
  await grab(page, title, target)
  await page.mouse.up()
  // dnd-kit держит защиту от «клика после переноса» ещё 50 мс; человек следующий перенос так быстро не начнёт, тест должен подождать
  await page.waitForTimeout(100)
}

/** Сколько запросов на изменение документов ушло на сервер */
function countPatches(page: Page) {
  const counter = { n: 0 }
  void page.route('**/api/v1/docs/*', (route) => {
    if (route.request().method() === 'PATCH') counter.n++
    return route.continue()
  })
  return counter
}

test.describe('заглушка на месте падения', () => {
  test('над левой половиной карточки заглушка встаёт перед ней, источник приглушён', async ({ page }) => {
    await openDocs(page)
    await expect(cardTitles(page)).toHaveText(ORDER)

    // размер карточки до переноса: заглушка берёт его же
    const srcBox = (await card(page, 'Заметки со встречи 15 окт').boundingBox())!

    await grab(page, 'Заметки со встречи 15 окт', () => inCard(page, 'Схема сервисов', 0.2))
    await expect(placeholders(page)).toHaveCount(1)
    await expect(card(page, 'Заметки со встречи 15 окт')).toHaveCSS('opacity', '0.4')
    // заглушка стоит непосредственно перед карточкой «Схема сервисов»
    await expect(page.locator('.dgrid .ph + .dcard')).toHaveAttribute('data-doc-id', await docId(page, 'Схема сервисов'))

    // те же размеры и вид, что у заглушки задач: пунктирная рамка акцентного цвета, высота переносимой карточки
    const ph = placeholders(page).first()
    await expect(ph).toHaveCSS('border-top-style', 'dashed')
    await expect(ph).toHaveCSS('border-top-width', '2px')
    const phBox = (await ph.boundingBox())!
    expect(Math.abs(phBox.height - srcBox.height)).toBeLessThanOrEqual(1)
    expect(Math.abs(phBox.width - srcBox.width)).toBeLessThanOrEqual(2)
    await page.screenshot({ path: 'output/docs-drag-placeholder.png' })

    await page.mouse.up()
    await expect(placeholders(page)).toHaveCount(0)
    await expect(card(page, 'Заметки со встречи 15 окт')).not.toHaveCSS('opacity', '0.4')
  })

  test('над правой половиной заглушка встаёт после карточки', async ({ page }) => {
    await openDocs(page)
    await grab(page, 'Схема сервисов', () => inCard(page, 'Планирование Q4', 0.8))
    await expect(placeholders(page)).toHaveCount(1)
    await expect(page.locator('.dgrid .ph + .dcard')).toHaveAttribute('data-doc-id', await docId(page, 'Идеи по онбордингу'))
    await page.mouse.up()
    await expect(cardTitles(page)).toHaveText(['Планирование Q4', 'Схема сервисов', 'Идеи по онбордингу', 'Заметки со встречи 15 окт'])
  })

  test('над правой половиной последней карточки заглушка встаёт в конец', async ({ page }) => {
    await openDocs(page)
    await grab(page, 'Схема сервисов', () => inCard(page, 'Заметки со встречи 15 окт', 0.85))
    await expect(placeholders(page)).toHaveCount(1)
    await expect(page.locator('.dgrid > :last-child')).toHaveClass(/\bph\b/)
    await page.mouse.up()
  })

  test('над самой переносимой карточкой и над её соседом справа заглушки нет: это то же место', async ({ page }) => {
    await openDocs(page)
    await grab(page, 'Планирование Q4', () => inCard(page, 'Планирование Q4', 0.3))
    await expect(placeholders(page)).toHaveCount(0)
    await moveTo(page, await inCard(page, 'Планирование Q4', 0.9))
    await expect(placeholders(page)).toHaveCount(0)
    await moveTo(page, await inCard(page, 'Схема сервисов', 0.9))
    await expect(placeholders(page)).toHaveCount(0)
    await page.mouse.up()
  })
})

test.describe('бросок', () => {
  test('на первое место: порядок меняется на экране и на сервере, после перезапуска остаётся', async ({ page }) => {
    await openDocs(page)
    await dragTo(page, 'Заметки со встречи 15 окт', () => inCard(page, 'Схема сервисов', 0.2))
    const expected = ['Заметки со встречи 15 окт', 'Схема сервисов', 'Планирование Q4', 'Идеи по онбордингу']
    await expect(cardTitles(page)).toHaveText(expected)
    await expect.poll(() => orderOnServer(page)).toEqual(expected)

    await page.reload()
    await expect(cardTitles(page)).toHaveText(expected)
  })

  test('в конец', async ({ page }) => {
    await openDocs(page)
    await dragTo(page, 'Схема сервисов', () => inCard(page, 'Заметки со встречи 15 окт', 0.85))
    const expected = ['Планирование Q4', 'Идеи по онбордингу', 'Заметки со встречи 15 окт', 'Схема сервисов']
    await expect(cardTitles(page)).toHaveText(expected)
    await expect.poll(() => orderOnServer(page)).toEqual(expected)
  })

  test('в середину', async ({ page }) => {
    await openDocs(page)
    await dragTo(page, 'Идеи по онбордингу', () => inCard(page, 'Планирование Q4', 0.2))
    const expected = ['Схема сервисов', 'Идеи по онбордингу', 'Планирование Q4', 'Заметки со встречи 15 окт']
    await expect(cardTitles(page)).toHaveText(expected)
    await expect.poll(() => orderOnServer(page)).toEqual(expected)
  })

  test('новый документ встаёт первым, а потом его можно поставить куда угодно', async ({ page }) => {
    await openDocs(page)
    await page.getByRole('button', { name: 'Новый документ' }).click()
    await page.getByLabel('Название документа').fill('Свежий')
    await page.getByRole('button', { name: 'Все документы' }).click()
    await expect(cardTitles(page).first()).toHaveText('Свежий')
    await dragTo(page, 'Свежий', () => inCard(page, 'Заметки со встречи 15 окт', 0.85))
    const expected = [...ORDER, 'Свежий']
    await expect(cardTitles(page)).toHaveText(expected)
    await expect.poll(() => orderOnServer(page)).toEqual(expected)
  })

  test('на то же место: запрос не уходит, документ не открывается', async ({ page }) => {
    await openDocs(page)
    const patches = countPatches(page)
    await dragTo(page, 'Планирование Q4', () => inCard(page, 'Планирование Q4', 0.3))
    await dragTo(page, 'Планирование Q4', () => inCard(page, 'Схема сервисов', 0.9))
    await dragTo(page, 'Заметки со встречи 15 окт', () => inCard(page, 'Заметки со встречи 15 окт', 0.9))
    await page.waitForTimeout(400)
    expect(patches.n).toBe(0)
    await expect(cardTitles(page)).toHaveText(ORDER)
    await expect(page.getByLabel('Название документа')).toHaveCount(0)
  })

  test('мимо списка: ничего не меняется', async ({ page }) => {
    await openDocs(page)
    const patches = countPatches(page)
    await dragTo(page, 'Идеи по онбордингу', async () => ({ x: 120, y: 700 })) // боковое меню
    await expect(placeholders(page)).toHaveCount(0)
    await expect(cardTitles(page)).toHaveText(ORDER)
    expect(patches.n).toBe(0)
  })

  test('звёздочка и открытие карточки работают после переноса', async ({ page }) => {
    await openDocs(page)
    await dragTo(page, 'Заметки со встречи 15 окт', () => inCard(page, 'Схема сервисов', 0.2))
    await card(page, 'Планирование Q4').getByRole('button', { name: 'В избранное' }).click()
    await expect.poll(async () => (await docSummaries(page)).find((d) => d.title === 'Планирование Q4')?.starred).toBe(true)
    await card(page, 'Идеи по онбордингу').locator('.dcard-open').click()
    await expect(page.getByLabel('Название документа')).toHaveValue('Идеи по онбордингу')
  })
})

test.describe('с фильтрами', () => {
  test('«Избранные»: порядок меняется во всём списке, скрытые документы остаются на местах позади', async ({ page }) => {
    // звёздочки: «Схема сервисов» (есть из сида) и «Идеи по онбордингу»; «Планирование Q4» и «Заметки» скрыты
    await api(page, `/docs/${await docId(page, 'Идеи по онбордингу')}/star`, { method: 'PUT', data: { starred: true } })
    await openDocs(page)
    await page.getByRole('button', { name: 'Избранные' }).click()
    await expect(cardTitles(page)).toHaveText(['Схема сервисов', 'Идеи по онбордингу'])

    // «Схема сервисов» в конец видимого: после «Идеи», но перед скрытой «Заметки», которая шла за ними
    await dragTo(page, 'Схема сервисов', () => inCard(page, 'Идеи по онбордингу', 0.85))
    await expect(cardTitles(page)).toHaveText(['Идеи по онбордингу', 'Схема сервисов'])
    await expect.poll(() => orderOnServer(page)).toEqual(['Планирование Q4', 'Идеи по онбордингу', 'Схема сервисов', 'Заметки со встречи 15 окт'])

    await page.getByRole('button', { name: 'Избранные' }).click()
    await expect(cardTitles(page)).toHaveText(['Планирование Q4', 'Идеи по онбордингу', 'Схема сервисов', 'Заметки со встречи 15 окт'])
  })

  test('поиск: перенос в найденном и общий порядок', async ({ page }) => {
    await openDocs(page)
    await page.getByRole('searchbox', { name: 'Поиск по документам' }).fill('релиз')
    await expect(cardTitles(page)).toHaveText(['Планирование Q4', 'Заметки со встречи 15 окт'])
    await dragTo(page, 'Заметки со встречи 15 окт', () => inCard(page, 'Планирование Q4', 0.2))
    await expect(cardTitles(page)).toHaveText(['Заметки со встречи 15 окт', 'Планирование Q4'])
    await expect.poll(() => orderOnServer(page)).toEqual(['Схема сервисов', 'Заметки со встречи 15 окт', 'Планирование Q4', 'Идеи по онбордингу'])
    await page.getByRole('searchbox', { name: 'Поиск по документам' }).fill('')
    await expect(cardTitles(page)).toHaveText(['Схема сервисов', 'Заметки со встречи 15 окт', 'Планирование Q4', 'Идеи по онбордингу'])
  })
})

test('сервер отказал: карточка возвращается на место и появляется плашка об ошибке', async ({ page }) => {
  await openDocs(page)
  await page.route('**/api/v1/docs/*', (route) => (route.request().method() === 'PATCH' ? route.fulfill({ status: 500, json: { code: 'internal', message: 'сбой' } }) : route.continue()))
  await dragTo(page, 'Заметки со встречи 15 окт', () => inCard(page, 'Схема сервисов', 0.2))
  await expect(page.getByText('Не удалось сохранить, изменение отменено')).toBeVisible()
  await expect(cardTitles(page)).toHaveText(ORDER)
  expect(await orderOnServer(page)).toEqual(ORDER)
})
