// Перенос страниц по дереву: заглушка на месте падения, зоны строки (перед, внутрь, после), раскрытые ветки, возврат на место.
// В макете такого переноса нет (решение владельца), поэтому здесь только поведение, эталонного снимка нет.

import { expect, test, type Page } from '@playwright/test'
import { resetData } from './fixtures'
import { editor, makePage, openPageById, openWiki, wikiNodes, blocks, expectSaved } from './wiki-helpers'

test.beforeEach(() => resetData())

const row = (page: Page, title: string) => page.locator('.tr', { has: page.getByRole('treeitem', { name: title, exact: true }) })
const placeholders = (page: Page) => page.locator('.tree .ph')
const treeTitles = (page: Page) => page.getByRole('tree', { name: 'Дерево страниц' }).getByRole('treeitem')

/** Названия страниц одного родителя в порядке сервера (null — корень) */
async function siblings(page: Page, parent: string | null): Promise<string[]> {
  const nodes = await wikiNodes(page)
  const parentId = parent ? nodes.find((n) => n.title === parent)!.id : null
  return nodes.filter((n) => n.parent_id === parentId).map((n) => n.title)
}

type Point = { x: number; y: number }

/** Точка внутри строки: `fy` — доля высоты сверху (0.1 — верхняя четверть, 0.5 — середина, 0.9 — нижняя), `dx` — сдвиг от левого края */
async function inRow(page: Page, title: string, fy: number, dx?: number): Promise<Point> {
  const box = await row(page, title).boundingBox()
  expect(box, `строка «${title}»`).not.toBeNull()
  return { x: box!.x + (dx ?? box!.width / 2), y: box!.y + box!.height * fy }
}

/**
 * Берёт страницу мышью и ведёт к цели, не отпуская. Цель — функция: заглушка сдвигает строки, и после первого движения
 * её положение надо измерить заново, пока указатель не окажется там, где задумано.
 */
async function grab(page: Page, title: string, target: () => Promise<Point>) {
  const from = await inRow(page, title, 0.5, 90)
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

async function dragTo(page: Page, title: string, target: () => Promise<Point>) {
  await grab(page, title, target)
  await page.mouse.up()
}

/** Сколько запросов на изменение страниц ушло на сервер */
function countPatches(page: Page) {
  const counter = { n: 0 }
  void page.route('**/api/v1/wiki/*', (route) => {
    if (route.request().method() === 'PATCH') counter.n++
    return route.continue()
  })
  return counter
}

test.describe('зоны строки', () => {
  test('верхняя четверть: заглушка перед страницей, после броска страница стоит перед ней', async ({ page }) => {
    await openWiki(page, 'Онбординг')
    await expect(treeTitles(page)).toHaveText(['Начало работы', 'Разработка', 'Процессы', 'Работа с задачами', 'Онбординг'])

    await grab(page, 'Онбординг', () => inRow(page, 'Начало работы', 0.1))
    await expect(placeholders(page)).toHaveCount(1)
    await expect(row(page, 'Онбординг')).toHaveCSS('opacity', '0.4')
    // заглушка стоит непосредственно перед строкой «Начало работы»
    await expect(page.locator('.tree .ph + .tr')).toHaveAttribute('data-tree-id', await idOf(page, 'Начало работы'))
    await page.mouse.up()

    await expect(placeholders(page)).toHaveCount(0)
    await expect(treeTitles(page)).toHaveText(['Онбординг', 'Начало работы', 'Разработка', 'Процессы', 'Работа с задачами'])
    await expect.poll(() => siblings(page, null)).toEqual(['Онбординг', 'Начало работы', 'Разработка', 'Процессы'])
    await expect.poll(() => siblings(page, 'Процессы')).toEqual(['Работа с задачами'])
  })

  test('нижняя четверть: заглушка после страницы', async ({ page }) => {
    await openWiki(page, 'Начало работы')
    await dragTo(page, 'Начало работы', () => inRow(page, 'Разработка', 0.9))
    await expect(treeTitles(page)).toHaveText(['Разработка', 'Начало работы', 'Процессы'])
    await expect.poll(() => siblings(page, null)).toEqual(['Разработка', 'Начало работы', 'Процессы'])
  })

  test('середина: страница вкладывается внутрь, строка подсвечена, заглушки нет', async ({ page }) => {
    await openWiki(page, 'Онбординг')
    await grab(page, 'Начало работы', () => inRow(page, 'Процессы', 0.5))
    await expect(placeholders(page)).toHaveCount(0)
    await expect(row(page, 'Процессы')).toHaveAttribute('style', /accent-soft/)
    await page.mouse.up()

    await expect(treeTitles(page)).toHaveText(['Разработка', 'Процессы', 'Работа с задачами', 'Онбординг', 'Начало работы'])
    await expect.poll(() => siblings(page, 'Процессы')).toEqual(['Работа с задачами', 'Онбординг', 'Начало работы'])
    await expect(row(page, 'Процессы')).not.toHaveAttribute('style', /accent-soft/)
  })

  test('внутрь свёрнутой страницы: она раскрывается, и перенесённая страница видна', async ({ page }) => {
    await openWiki(page, 'Начало работы')
    await expect(treeTitles(page)).toHaveText(['Начало работы', 'Разработка', 'Процессы'])
    await dragTo(page, 'Начало работы', () => inRow(page, 'Разработка', 0.5))
    await expect(treeTitles(page)).toHaveText(['Разработка', 'Соглашения по коду', 'Деплой и окружения', 'Начало работы', 'Процессы'])
    await expect.poll(() => siblings(page, 'Разработка')).toEqual(['Соглашения по коду', 'Деплой и окружения', 'Начало работы'])
  })

  test('перестановка среди соседей', async ({ page }) => {
    await openWiki(page, 'Соглашения по коду')
    await dragTo(page, 'Деплой и окружения', () => inRow(page, 'Соглашения по коду', 0.1))
    await expect.poll(() => siblings(page, 'Разработка')).toEqual(['Деплой и окружения', 'Соглашения по коду'])
    await expect(treeTitles(page)).toHaveText(['Начало работы', 'Разработка', 'Деплой и окружения', 'Соглашения по коду', 'Процессы'])
  })

  test('страница из вложенных переезжает в корень', async ({ page }) => {
    await openWiki(page, 'Соглашения по коду')
    await dragTo(page, 'Соглашения по коду', () => inRow(page, 'Процессы', 0.1))
    await expect.poll(() => siblings(page, null)).toEqual(['Начало работы', 'Разработка', 'Соглашения по коду', 'Процессы'])
    await expect.poll(() => siblings(page, 'Разработка')).toEqual(['Деплой и окружения'])
  })

  test('ниже последней строки: в конец списка', async ({ page }) => {
    await openWiki(page, 'Начало работы')
    const button = page.getByRole('button', { name: 'Новая страница' })
    await grab(page, 'Начало работы', async () => {
      const box = (await button.boundingBox())!
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    })
    await expect(placeholders(page)).toHaveCount(1)
    await page.mouse.up()
    await expect.poll(() => siblings(page, null)).toEqual(['Разработка', 'Процессы', 'Начало работы'])
  })
})

test.describe('раскрытая страница', () => {
  test('нижняя четверть раскрытой страницы: после всей её ветки, на её уровне', async ({ page }) => {
    await openWiki(page, 'Соглашения по коду')
    await grab(page, 'Начало работы', () => inRow(page, 'Разработка', 0.9))
    await expect(placeholders(page)).toHaveCount(1)
    // заглушка после последней страницы ветки и без отступа вложенности
    await expect(page.locator('.tree .tr[data-tree-id] + .ph').first()).toBeVisible()
    await expect(placeholders(page)).toHaveCSS('margin-left', '6px')
    const ph = (await placeholders(page).boundingBox())!
    const last = (await row(page, 'Деплой и окружения').boundingBox())!
    expect(ph.y).toBeGreaterThan(last.y)
    await page.mouse.up()
    await expect.poll(() => siblings(page, null)).toEqual(['Разработка', 'Начало работы', 'Процессы'])
    await expect.poll(() => siblings(page, 'Разработка')).toEqual(['Соглашения по коду', 'Деплой и окружения'])
  })

  test('середина раскрытой страницы: в конец её вложенных', async ({ page }) => {
    await openWiki(page, 'Соглашения по коду')
    await dragTo(page, 'Начало работы', () => inRow(page, 'Разработка', 0.5))
    await expect.poll(() => siblings(page, 'Разработка')).toEqual(['Соглашения по коду', 'Деплой и окружения', 'Начало работы'])
  })

  test('верхняя четверть первой вложенной: первой среди вложенных', async ({ page }) => {
    await openWiki(page, 'Соглашения по коду')
    await grab(page, 'Начало работы', () => inRow(page, 'Соглашения по коду', 0.1))
    await expect(placeholders(page)).toHaveCSS('margin-left', '22px')
    await page.mouse.up()
    await expect.poll(() => siblings(page, 'Разработка')).toEqual(['Начало работы', 'Соглашения по коду', 'Деплой и окружения'])
  })

  test('нижняя четверть последней вложенной: правее — последней вложенной, левее — после родителя', async ({ page }) => {
    await openWiki(page, 'Соглашения по коду')

    // правее: остаётся вложенной в «Разработку»
    await grab(page, 'Начало работы', () => inRow(page, 'Деплой и окружения', 0.9))
    await expect(placeholders(page)).toHaveCSS('margin-left', '22px')
    // левее на один уровень: на уровне «Разработки»
    const left = await inRow(page, 'Деплой и окружения', 0.9, 8)
    await page.mouse.move(left.x, left.y, { steps: 6 })
    await page.waitForTimeout(150)
    await expect(placeholders(page)).toHaveCSS('margin-left', '6px')
    // и обратно вправо: снова последняя вложенная
    const right = await inRow(page, 'Деплой и окружения', 0.9)
    await page.mouse.move(right.x, right.y, { steps: 6 })
    await page.waitForTimeout(150)
    await expect(placeholders(page)).toHaveCSS('margin-left', '22px')
    await page.mouse.up()
    await expect.poll(() => siblings(page, 'Разработка')).toEqual(['Соглашения по коду', 'Деплой и окружения', 'Начало работы'])
    await expect.poll(() => siblings(page, null)).toEqual(['Разработка', 'Процессы'])
  })

  test('нижняя четверть последней вложенной, указатель левее: после родителя', async ({ page }) => {
    await openWiki(page, 'Соглашения по коду')
    await dragTo(page, 'Начало работы', () => inRow(page, 'Деплой и окружения', 0.9, 8))
    await expect.poll(() => siblings(page, null)).toEqual(['Разработка', 'Начало работы', 'Процессы'])
    await expect.poll(() => siblings(page, 'Разработка')).toEqual(['Соглашения по коду', 'Деплой и окружения'])
  })
})

test.describe('когда переносить нельзя или не нужно', () => {
  test('на своё место: заглушки нет и запроса нет', async ({ page }) => {
    await openWiki(page, 'Начало работы')
    const patches = countPatches(page)
    // «Разработка» уже стоит перед «Процессами»
    await grab(page, 'Разработка', () => inRow(page, 'Процессы', 0.1))
    await expect(placeholders(page)).toHaveCount(0)
    await page.mouse.up()
    await page.waitForTimeout(300)
    expect(patches.n).toBe(0)
    await expect(treeTitles(page)).toHaveText(['Начало работы', 'Разработка', 'Процессы'])
  })

  test('внутрь собственной ветки нельзя: ни заглушки, ни подсветки, ни запроса', async ({ page }) => {
    await openWiki(page, 'Соглашения по коду')
    const patches = countPatches(page)
    await grab(page, 'Разработка', () => inRow(page, 'Деплой и окружения', 0.5))
    await expect(placeholders(page)).toHaveCount(0)
    await expect(row(page, 'Деплой и окружения')).not.toHaveAttribute('style', /accent-soft/)
    await page.mouse.up()
    await page.waitForTimeout(300)
    expect(patches.n).toBe(0)
    await expect.poll(() => siblings(page, 'Разработка')).toEqual(['Соглашения по коду', 'Деплой и окружения'])
  })

  test('вместе со страницей переезжают её вложенные', async ({ page }) => {
    await openWiki(page, 'Соглашения по коду')
    await dragTo(page, 'Разработка', () => inRow(page, 'Процессы', 0.5))
    await expect.poll(() => siblings(page, 'Процессы')).toEqual(['Работа с задачами', 'Онбординг', 'Разработка'])
    await expect.poll(() => siblings(page, 'Разработка')).toEqual(['Соглашения по коду', 'Деплой и окружения'])
  })

  test('пока идёт поиск, страницы не переносятся', async ({ page }) => {
    await openWiki(page, 'Начало работы')
    const patches = countPatches(page)
    await page.getByPlaceholder('Поиск страниц').fill('о')
    const count = await treeTitles(page).count()
    expect(count).toBeGreaterThan(2)
    const from = await inRow(page, 'Разработка', 0.5, 90)
    const to = await inRow(page, 'Начало работы', 0.1)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 12 })
    await expect(placeholders(page)).toHaveCount(0)
    await expect(page.locator('.drag-overlay')).toHaveCount(0)
    await page.mouse.up()
    await page.waitForTimeout(300)
    expect(patches.n).toBe(0)
  })

  test('обычный щелчок по строке по-прежнему открывает страницу', async ({ page }) => {
    await openWiki(page, 'Начало работы')
    await row(page, 'Процессы').getByRole('treeitem').click()
    await expect(page.getByLabel('Название страницы')).toHaveValue('Процессы')
  })

  test('сервер отказал: страница возвращается на место, показана плашка', async ({ page }) => {
    await openWiki(page, 'Онбординг')
    await page.route('**/api/v1/wiki/*', (route) =>
      route.request().method() === 'PATCH' ? route.fulfill({ status: 500, json: { code: 'internal', message: 'Внутренняя ошибка сервера' } }) : route.continue(),
    )
    await dragTo(page, 'Онбординг', () => inRow(page, 'Начало работы', 0.1))
    await expect(page.getByText('Не удалось сохранить, изменение отменено')).toBeVisible()
    await expect(treeTitles(page)).toHaveText(['Начало работы', 'Разработка', 'Процессы', 'Работа с задачами', 'Онбординг'])
    expect(await siblings(page, 'Процессы')).toEqual(['Работа с задачами', 'Онбординг'])
  })
})

test.describe('перенос и редактирование', () => {
  test('перенос открытой страницы с несохранённой правкой не даёт конфликта версий', async ({ page }) => {
    const id = await makePage(page, 'Двигаемая', 'Текст')
    await openPageById(page, id)
    await blocks(page).first().click()
    await page.keyboard.type(' плюс')
    // тянем её же строку: правка уходит на сервер, перенос идёт отдельным запросом без версии
    await dragTo(page, 'Двигаемая', () => inRow(page, 'Начало работы', 0.1))
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expectSaved(page, id, 'Текст плюс')
    await expect.poll(() => siblings(page, null)).toEqual(['Двигаемая', 'Начало работы', 'Разработка', 'Процессы'])

    // и дальше она сохраняется как обычно
    await blocks(page).first().click()
    await page.keyboard.type('!')
    await page.keyboard.press('Escape')
    await expectSaved(page, id, 'Текст плюс!')
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(editor(page)).toHaveCount(0)
  })

  test('новый порядок остаётся после перезагрузки', async ({ page }) => {
    await openWiki(page, 'Начало работы')
    await dragTo(page, 'Процессы', () => inRow(page, 'Начало работы', 0.1))
    await expect.poll(() => siblings(page, null)).toEqual(['Процессы', 'Начало работы', 'Разработка'])
    await page.reload()
    await expect(treeTitles(page).first()).toHaveText('Процессы')
  })
})

async function idOf(page: Page, title: string): Promise<string> {
  return (await wikiNodes(page)).find((n) => n.title === title)!.id
}
