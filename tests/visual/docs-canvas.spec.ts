// Холст: добавление и правка объектов, перетаскивание (на сервер только по отпусканию), карточка с текстом,
// стрелки (два клика, повторный убирает), удаление, сохранение после перезапуска.

import { expect, test, type Locator, type Page } from '@playwright/test'
import { docFull, expectCanvas, items, openDocByTitle } from './docs-helpers'
import { resetData } from './fixtures'

test.beforeEach(() => resetData())

const lines = (page: Page) => page.locator('.cv .wb-line')
const tools = (page: Page) => page.getByRole('toolbar', { name: 'Инструменты холста' })
/** Объект холста с точным названием: «Сервис пользователей» не путается с другими */
const named = (page: Page, text: string) => items(page).filter({ has: page.getByText(text, { exact: true }) })

async function center(el: Locator) {
  const box = await el.boundingBox()
  expect(box).not.toBeNull()
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
}

/** Сколько запросов на сохранение холста ушло на сервер */
function countCanvasSaves(page: Page) {
  const counter = { n: 0 }
  void page.route('**/api/v1/docs/*/canvas', (route) => {
    if (route.request().method() === 'PUT') counter.n++
    return route.continue()
  })
  return counter
}

/** Цвет из палитры так, как его видит браузер (rgb(...)) */
const colorOf = (page: Page, value: string) =>
  page.evaluate((v) => {
    const el = document.createElement('i')
    el.style.color = v
    document.querySelector('.app')!.appendChild(el)
    const color = getComputedStyle(el).color
    el.remove()
    return color
  }, value)

test.describe('новые объекты', () => {
  test('«+ Стикер» кладёт стикер справа от карточки с текстом, выбирает его и сохраняет на сервере', async ({ page }) => {
    const id = await openDocByTitle(page, 'Схема сервисов')
    await tools(page).getByRole('button', { name: '+ Стикер' }).click()

    await expect(items(page)).toHaveCount(8)
    const added = items(page).last()
    await expect(added).toHaveClass(/\bsticky\b/)
    await expect(added).toHaveClass(/\bsel\b/)
    await expect(added).toHaveText('Пусто')
    // карточка в 24 с шириной 400, объектов уже 7: x = 24 + 400 + 40 + (7 % 6) * 26, y = 60 + 26
    await expect(added).toHaveCSS('left', '490px')
    await expect(added).toHaveCSS('top', '86px')
    await expect(added).toHaveCSS('width', '190px')
    await expect(added).toHaveCSS('height', '120px')

    await expectCanvas(page, id, (d) => d.objects.length, 8)
    const saved = (await docFull(page, id)).objects.at(-1)!
    expect(saved).toMatchObject({ type: 'sticky', x: 490, y: 86, w: 190, h: 120, text: '', color: 6 })
  })

  test('все четыре вида: размеры и подписи по умолчанию', async ({ page }) => {
    await openDocByTitle(page, 'Планирование Q4')
    await page.getByRole('group', { name: 'Режим документа' }).getByRole('button', { name: 'Холст', exact: true }).click()
    const sizes: Array<[string, string, string, string, string]> = [
      ['+ Стикер', 'sticky', '190px', '120px', 'Пусто'],
      ['+ Фигура', 'rect', '160px', '80px', 'Пусто'],
      ['+ Овал', 'ellipse', '160px', '90px', 'Пусто'],
      ['+ Текст', 'text', '200px', '40px', 'Текст'],
    ]
    for (const [button, kind, w, h, label] of sizes) {
      await tools(page).getByRole('button', { name: button }).click()
      const last = items(page).last()
      await expect(last).toHaveClass(new RegExp(`\\b${kind}\\b`))
      await expect(last).toHaveCSS('width', w)
      await expect(last).toHaveCSS('height', h)
      await expect(last).toHaveText(label)
    }
    await expect(items(page)).toHaveCount(4)
    // справа от карточки с текстом (x 24, ширина 440), каждый следующий со сдвигом 26 вправо и вниз
    const lefts = await items(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).style.left))
    expect(lefts).toEqual(['504px', '530px', '556px', '582px'])
  })

  test('у выбранного объекта правятся текст и цвет, «Удалить» убирает', async ({ page }) => {
    const id = await openDocByTitle(page, 'Схема сервисов')
    await tools(page).getByRole('button', { name: '+ Фигура' }).click()
    const added = items(page).last()
    await tools(page).getByLabel('Текст выбранного объекта').fill('Кэш')
    await expect(added).toHaveText('Кэш')
    await tools(page).getByRole('group', { name: 'Цвет объекта' }).getByRole('button').nth(7).click()

    await expectCanvas(page, id, (d) => d.objects.at(-1)?.text, 'Кэш')
    await expectCanvas(page, id, (d) => d.objects.at(-1)?.color, 7)
    // цвет объекта — из палитры: фон и цвет текста берутся из пары «e»
    await expect(added).toHaveCSS('color', await colorOf(page, 'var(--e-fg)'))
    await expect(added).toHaveCSS('background-color', await colorOf(page, 'var(--e-bg)'))

    await tools(page).getByRole('button', { name: 'Удалить' }).click()
    await expect(items(page)).toHaveCount(7)
    await expect(tools(page).getByLabel('Текст выбранного объекта')).toHaveCount(0)
    await expectCanvas(page, id, (d) => d.objects.length, 7)
  })

  test('клик по пустому месту холста снимает выбор', async ({ page }) => {
    await openDocByTitle(page, 'Схема сервисов')
    await named(page, 'Клиент').click()
    await expect(named(page, 'Клиент')).toHaveClass(/\bsel\b/)
    await expect(tools(page).getByLabel('Текст выбранного объекта')).toHaveValue('Клиент')

    await page.mouse.click(900, 600) // пустое место холста
    await expect(named(page, 'Клиент')).not.toHaveClass(/\bsel\b/)
    await expect(tools(page).getByLabel('Текст выбранного объекта')).toHaveCount(0)
  })
})

test.describe('перетаскивание', () => {
  test('объект двигается за указателем; на сервер уходит один раз, когда указатель отпустили', async ({ page }) => {
    const id = await openDocByTitle(page, 'Схема сервисов')
    const saves = countCanvasSaves(page)
    const before = (await docFull(page, id)).objects.find((o) => o.text === 'Клиент')!
    const box = (await named(page, 'Клиент').boundingBox())!

    const from = await center(named(page, 'Клиент'))
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + 20, from.y + 60, { steps: 5 })
    await page.mouse.move(from.x + 40, from.y + 150, { steps: 5 })

    // объект уже на новом месте, а на сервере всё по-старому: идёт только локальное состояние
    const moved = (await named(page, 'Клиент').boundingBox())!
    expect(Math.round(moved.x - box.x)).toBe(40)
    expect(Math.round(moved.y - box.y)).toBe(150)
    await page.waitForTimeout(900) // дольше паузы сохранения
    expect(saves.n).toBe(0)
    expect((await docFull(page, id)).objects.find((o) => o.text === 'Клиент')).toMatchObject({ x: before.x, y: before.y })

    await page.mouse.up()
    await expectCanvas(page, id, (d) => d.objects.find((o) => o.text === 'Клиент')?.x, before.x + 40)
    await expectCanvas(page, id, (d) => d.objects.find((o) => o.text === 'Клиент')?.y, before.y + 150)
    expect(saves.n).toBe(1)
    // стрелка тянется за объектом: линий по-прежнему пять
    await expect(lines(page)).toHaveCount(5)
  })

  test('объект нельзя утащить за левый и верхний край холста', async ({ page }) => {
    const id = await openDocByTitle(page, 'Схема сервисов')
    const from = await center(named(page, 'Клиент'))
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x - 900, from.y - 400, { steps: 8 })
    await page.mouse.up()
    await expectCanvas(page, id, (d) => [d.objects.find((o) => o.text === 'Клиент')?.x, d.objects.find((o) => o.text === 'Клиент')?.y], [0, 0])
  })

  test('карточка с текстом двигается за верхнюю полоску и хранит положение', async ({ page }) => {
    const id = await openDocByTitle(page, 'Схема сервисов')
    const saves = countCanvasSaves(page)
    const grip = page.locator('.note-grip')
    const from = await center(grip)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + 80, from.y + 40, { steps: 6 })
    await expect(page.locator('.note.edge')).toHaveCSS('left', '104px')
    await expect(page.locator('.note.edge')).toHaveCSS('top', '68px')
    expect(saves.n).toBe(0)
    await page.mouse.up()
    await expectCanvas(page, id, (d) => d.note, { x: 104, y: 68, w: 400 })

    await page.reload()
    await expect(page.locator('.note.edge')).toHaveCSS('left', '104px')
    await expect(page.locator('.note.edge')).toHaveCSS('top', '68px')
  })

  test('положение объектов сохраняется после перезапуска', async ({ page }) => {
    const id = await openDocByTitle(page, 'Схема сервисов')
    const start = (await docFull(page, id)).objects.find((o) => o.text === 'Клиент')!
    const startBox = (await named(page, 'Клиент').boundingBox())!
    const from = await center(named(page, 'Клиент'))
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + 50, from.y + 150, { steps: 6 })
    await page.mouse.up()
    await expectCanvas(page, id, (d) => d.objects.find((o) => o.text === 'Клиент')?.y, start.y + 150)

    await page.reload()
    await expect(items(page)).toHaveCount(7)
    const after = (await named(page, 'Клиент').boundingBox())!
    expect(Math.round(after.x - startBox.x)).toBe(50)
    expect(Math.round(after.y - startBox.y)).toBe(150)
  })

  test('клик по объекту без движения выбирает его и ничего не сохраняет', async ({ page }) => {
    const id = await openDocByTitle(page, 'Схема сервисов')
    const saves = countCanvasSaves(page)
    const rev = (await docFull(page, id)).canvas_rev
    await named(page, 'API-шлюз').click()
    await expect(named(page, 'API-шлюз')).toHaveClass(/\bsel\b/)
    await page.waitForTimeout(900)
    expect(saves.n).toBe(0)
    expect((await docFull(page, id)).canvas_rev).toBe(rev)
  })
})

test.describe('стрелки', () => {
  test('два клика подряд в режиме «Стрелка» соединяют объекты, повторная пара убирает стрелку', async ({ page }) => {
    const id = await openDocByTitle(page, 'Схема сервисов')
    await expect(lines(page)).toHaveCount(5)
    const hint = page.getByText('Текст документа лежит на холсте карточкой', { exact: false })
    await expect(hint).toBeVisible()

    const arrow = tools(page).getByRole('button', { name: 'Стрелка' })
    await arrow.click()
    await expect(arrow).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('Режим стрелок: нажми два объекта подряд')).toBeVisible()

    // «Клиент» → «Очередь заданий»: такой стрелки ещё нет
    await named(page, 'Клиент').click()
    await expect(named(page, 'Клиент')).toHaveClass(/\bsel\b/)
    await named(page, 'Очередь заданий').click()
    await expect(lines(page)).toHaveCount(6)
    await expectCanvas(page, id, (d) => d.links.length, 6)

    // та же пара ещё раз, в обратную сторону: стрелка убирается
    await named(page, 'Очередь заданий').click()
    await named(page, 'Клиент').click()
    await expect(lines(page)).toHaveCount(5)
    await expectCanvas(page, id, (d) => d.links.length, 5)

    // повторный клик по первому объекту отменяет начатую стрелку
    await named(page, 'Клиент').click()
    await named(page, 'Клиент').click()
    await named(page, 'Очередь заданий').click()
    await expect(lines(page)).toHaveCount(5)

    await arrow.click()
    await expect(arrow).toHaveAttribute('aria-pressed', 'false')
  })

  test('стрелка идёт от границы одного объекта до границы другого повёрнутым div и не рисуется у пересекающихся', async ({ page }) => {
    await openDocByTitle(page, 'Схема сервисов')
    // «Клиент» → «API-шлюз» из макета: от правого края (570) до левого (620) на высоте 152 − 1
    const styles = await lines(page).evaluateAll((els) =>
      els.map((el) => ({ left: (el as HTMLElement).style.left, top: (el as HTMLElement).style.top, width: (el as HTMLElement).style.width, transform: (el as HTMLElement).style.transform })),
    )
    const flat = styles.find((l) => l.left === '570px')
    expect(flat, 'линия от правого края «Клиента»').toMatchObject({ top: '151px', width: '50px' })
    expect(flat!.transform).toMatch(/rotate\(0(\.0+)?deg\)/)

    // «Клиент» наезжает на «API-шлюз»: стрелки между ними нет, остальные на месте
    const klient = await center(named(page, 'Клиент'))
    const target = await center(named(page, 'API-шлюз'))
    await page.mouse.move(klient.x, klient.y)
    await page.mouse.down()
    await page.mouse.move(target.x - 30, target.y, { steps: 8 })
    await page.mouse.up()
    await expect(lines(page)).toHaveCount(4)
  })

  test('удаление объекта убирает и его стрелки', async ({ page }) => {
    const id = await openDocByTitle(page, 'Схема сервисов')
    await named(page, 'Сервис пользователей').click()
    await tools(page).getByRole('button', { name: 'Удалить' }).click()
    await expect(items(page)).toHaveCount(6)
    // у «Сервиса пользователей» были две стрелки: от шлюза и к базе данных
    await expect(lines(page)).toHaveCount(3)
    await expectCanvas(page, id, (d) => [d.objects.length, d.links.length], [6, 3])
  })

  test('режим стрелок: объект не двигается и не выбирается как при перетаскивании', async ({ page }) => {
    const id = await openDocByTitle(page, 'Схема сервисов')
    await tools(page).getByRole('button', { name: 'Стрелка' }).click()
    const before = (await docFull(page, id)).objects.find((o) => o.text === 'Клиент')!
    const from = await center(named(page, 'Клиент'))
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + 100, from.y + 100, { steps: 5 })
    await page.mouse.up()
    expect((await docFull(page, id)).objects.find((o) => o.text === 'Клиент')).toMatchObject({ x: before.x, y: before.y })
  })
})

test('новый объект лежит поверх прежних и на сервере тоже идёт последним', async ({ page }) => {
  const id = await openDocByTitle(page, 'Идеи по онбордингу')
  await page.getByRole('group', { name: 'Режим документа' }).getByRole('button', { name: 'Холст', exact: true }).click()
  await expect(items(page)).toHaveCount(3)
  await tools(page).getByRole('button', { name: '+ Текст' }).click()
  await expectCanvas(page, id, (d) => d.objects.map((o) => o.type), ['sticky', 'sticky', 'sticky', 'text'])
})
