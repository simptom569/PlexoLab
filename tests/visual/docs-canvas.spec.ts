// Холст: добавление и правка объектов, перетаскивание (на сервер только по отпусканию), карточка с текстом,
// стрелки (два клика, повторный убирает), удаление, сохранение после перезапуска.

import { expect, test, type Locator, type Page } from '@playwright/test'
import { docFull, docId, expectCanvas, items, makeDoc, openDoc, openDocByTitle } from './docs-helpers'
import { openApp, resetData } from './fixtures'

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

  test('объект можно утащить левее и выше начала координат: числа уходят в минус и сохраняются', async ({ page }) => {
    const id = await openDocByTitle(page, 'Схема сервисов')
    // сначала сдвигаем холст, чтобы начало координат оказалось правее и ниже: так объекту есть куда идти, а указатель
    // остаётся вдали от краёв окна (у края холст поехал бы сам)
    await wheelOver(page, { x: 0, y: -400 }, { shift: true })
    await wheelOver(page, { x: 0, y: -300 })
    const before = (await docFull(page, id)).objects.find((o) => o.text === 'Клиент')!
    const from = await center(named(page, 'Клиент'))
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x - 800, from.y - 150, { steps: 8 })
    await page.mouse.up()
    await expectCanvas(page, id, (d) => [d.objects.find((o) => o.text === 'Клиент')?.x, d.objects.find((o) => o.text === 'Клиент')?.y], [before.x - 800, before.y - 150])
    expect(before.x - 800).toBeLessThan(0)
    expect(before.y - 150).toBeLessThan(0)

    // и после перезапуска объект на месте, левее и выше нуля
    await page.reload()
    await expect(named(page, 'Клиент')).toHaveCSS('left', `${before.x - 800}px`)
    await expect(named(page, 'Клиент')).toHaveCSS('top', `${before.y - 150}px`)
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

// ---- Камера: холст двигается колесом и пустым местом, объекты не зависят от окна ----

/** Камера: на сколько сдвинут слой холста и в каком он масштабе (по матрице, как видит браузер) */
const cameraOf = (page: Page) =>
  page.locator('.cv-world').evaluate((el) => {
    const m = new DOMMatrix(getComputedStyle(el).transform)
    return { x: m.e, y: m.f, z: m.a }
  })

const canvasBox = async (page: Page) => (await page.locator('.cv.edge').boundingBox())!

/** Пустое место холста: правее карточки с текстом и ниже всех объектов, выше панели инструментов */
const emptySpot = async (page: Page) => {
  const box = await canvasBox(page)
  return { x: box.x + box.width - 200, y: box.y + box.height - 150 }
}

/** Колесо над пустым местом холста; с Shift вертикальное колесо двигает по горизонтали */
async function wheelOver(page: Page, delta: { x: number; y: number }, options: { shift?: boolean } = {}) {
  const at = await emptySpot(page)
  await page.mouse.move(at.x, at.y)
  if (options.shift) await page.keyboard.down('Shift')
  await page.mouse.wheel(delta.x, delta.y)
  if (options.shift) await page.keyboard.up('Shift')
}

test.describe('камера холста', () => {
  test('колесо двигает холст, а не страницу; объекты остаются на своих числах', async ({ page }) => {
    await openDocByTitle(page, 'Схема сервисов')
    const scrollY = await page.evaluate(() => window.scrollY)
    const leftBefore = await named(page, 'Клиент').evaluate((el) => (el as HTMLElement).style.left)
    const boxBefore = (await named(page, 'Клиент').boundingBox())!

    await wheelOver(page, { x: 0, y: 120 })
    await expect.poll(async () => (await cameraOf(page)).y).toBe(-120)
    expect((await cameraOf(page)).x).toBe(0)
    expect(await page.evaluate(() => window.scrollY), 'страница не прокрутилась').toBe(scrollY)
    // на экране объект уехал вверх, а его положение на холсте то же
    const boxAfter = (await named(page, 'Клиент').boundingBox())!
    expect(Math.round(boxAfter.y - boxBefore.y)).toBe(-120)
    expect(await named(page, 'Клиент').evaluate((el) => (el as HTMLElement).style.left)).toBe(leftBefore)

    // с Shift колесо двигает по горизонтали
    await wheelOver(page, { x: 0, y: 80 }, { shift: true })
    await expect.poll(async () => (await cameraOf(page)).x).toBe(-80)
  })

  test('сетка точек на фоне едет вместе с холстом', async ({ page }) => {
    await openDocByTitle(page, 'Схема сервисов')
    await expect(page.locator('.cv.edge')).toHaveCSS('background-position', '0px 0px')
    await expect(page.locator('.cv.edge')).toHaveCSS('background-size', '22px 22px')
    await wheelOver(page, { x: 0, y: 50 })
    await wheelOver(page, { x: 0, y: 70 }, { shift: true })
    await expect(page.locator('.cv.edge')).toHaveCSS('background-position', '-70px -50px')
  })

  test('пустое место берёт холст: он двигается за указателем, ничего не сохраняется, выбор снимается', async ({ page }) => {
    const id = await openDocByTitle(page, 'Схема сервисов')
    const saves = countCanvasSaves(page)
    const rev = (await docFull(page, id)).canvas_rev
    await named(page, 'Клиент').click()
    await expect(named(page, 'Клиент')).toHaveClass(/\bsel\b/)

    const at = await emptySpot(page)
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await page.mouse.move(at.x - 120, at.y - 50, { steps: 6 })
    await expect(page.locator('.cv.edge')).toHaveClass(/\bpanning\b/)
    await page.mouse.up()
    await expect(page.locator('.cv.edge')).not.toHaveClass(/\bpanning\b/)

    expect(await cameraOf(page)).toMatchObject({ x: -120, y: -50 })
    await expect(named(page, 'Клиент')).not.toHaveClass(/\bsel\b/)
    await page.waitForTimeout(900)
    expect(saves.n).toBe(0)
    expect((await docFull(page, id)).canvas_rev).toBe(rev)
  })

  test('средняя кнопка двигает холст даже над объектом и объект не трогает', async ({ page }) => {
    const id = await openDocByTitle(page, 'Схема сервисов')
    const before = (await docFull(page, id)).objects.find((o) => o.text === 'Клиент')!
    const from = await center(named(page, 'Клиент'))
    await page.mouse.move(from.x, from.y)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(from.x + 90, from.y + 40, { steps: 5 })
    await page.mouse.up({ button: 'middle' })
    expect(await cameraOf(page)).toMatchObject({ x: 90, y: 40 })
    await page.waitForTimeout(900)
    expect((await docFull(page, id)).objects.find((o) => o.text === 'Клиент')).toMatchObject({ x: before.x, y: before.y })
  })

  test('объект тащат у края: холст едет сам, объект остаётся под указателем и на обратном пути не отстаёт', async ({ page }) => {
    const id = await openDocByTitle(page, 'Схема сервисов')
    const canvas = await canvasBox(page)
    const item = named(page, 'Клиент')
    const start = await center(item)
    const inside = start.x - (await item.boundingBox())!.x // где внутри объекта взялись

    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + 8, start.y, { steps: 3 })
    // к самому правому краю: холст поедет влево, пока указатель там
    await page.mouse.move(canvas.x + canvas.width - 10, start.y, { steps: 12 })
    await expect.poll(async () => (await cameraOf(page)).x, { message: 'холст поехал сам' }).toBeLessThan(-150)

    const glued = async (pointerX: number) => {
      const box = (await item.boundingBox())!
      expect(Math.abs(box.x + inside - pointerX), `объект под указателем (${pointerX})`).toBeLessThanOrEqual(1)
    }
    // уводим указатель от края: холст встал, объект под указателем
    const mid = canvas.x + canvas.width / 2
    await page.mouse.move(mid, start.y, { steps: 8 })
    await page.waitForTimeout(120)
    const stopped = await cameraOf(page)
    await glued(mid)
    // обратно влево: холст не сжимается и не прыгает, объект идёт за указателем шаг в шаг
    for (const x of [mid - 60, mid - 140, mid - 220, mid - 300]) {
      await page.mouse.move(x, start.y, { steps: 5 })
      await page.waitForTimeout(60)
      await glued(x)
    }
    expect(await cameraOf(page), 'камера на обратном пути не двигалась').toEqual(stopped)

    // что нарисовано, то и сохранено
    const shown = parseFloat(await item.evaluate((el) => (el as HTMLElement).style.left))
    await page.mouse.up()
    await expectCanvas(page, id, (d) => d.objects.find((o) => o.text === 'Клиент')?.x, shown)
    expect(shown).toBeGreaterThan(460)
  })

  test('карточку с текстом тоже можно тащить к краю: холст едет, карточка остаётся под указателем', async ({ page }) => {
    await openDocByTitle(page, 'Схема сервисов')
    const canvas = await canvasBox(page)
    const grip = await center(page.locator('.note-grip'))
    await page.mouse.move(grip.x, grip.y)
    await page.mouse.down()
    await page.mouse.move(grip.x + 8, grip.y, { steps: 3 })
    await page.mouse.move(canvas.x + canvas.width - 10, grip.y, { steps: 12 })
    await expect.poll(async () => (await cameraOf(page)).x).toBeLessThan(-150)
    const mid = canvas.x + canvas.width / 2
    await page.mouse.move(mid, grip.y, { steps: 6 })
    await page.waitForTimeout(120)
    // полоску взяли за середину: она под указателем
    const gripBox = (await page.locator('.note-grip').boundingBox())!
    expect(Math.abs(gripBox.x + gripBox.width / 2 - mid)).toBeLessThanOrEqual(1)
    await page.mouse.up()
  })

  test('новый объект встаёт в видимую часть, если холст уехал далеко', async ({ page }) => {
    await openDocByTitle(page, 'Схема сервисов')
    await wheelOver(page, { x: 0, y: 3000 }, { shift: true })
    await expect.poll(async () => (await cameraOf(page)).x).toBe(-3000)
    await tools(page).getByRole('button', { name: '+ Стикер' }).click()
    const box = (await items(page).last().boundingBox())!
    const canvas = await canvasBox(page)
    expect(box.x).toBeGreaterThanOrEqual(canvas.x)
    expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width)
    expect(box.y).toBeGreaterThanOrEqual(canvas.y)
    expect(box.y + box.height).toBeLessThanOrEqual(canvas.y + canvas.height)
  })

  test('с клавиатуры: Tab к объекту, которого не видно, двигает холст к нему', async ({ page }) => {
    await openDocByTitle(page, 'Схема сервисов')
    await named(page, 'Клиент').focus()
    await wheelOver(page, { x: 0, y: 1500 }, { shift: true }) // всё уехало влево за край
    await expect.poll(async () => (await cameraOf(page)).x).toBe(-1500)
    const next = named(page, 'API-шлюз') // следующий по порядку
    const canvas = await canvasBox(page)
    const hidden = (await next.boundingBox())!
    expect(hidden.x + hidden.width).toBeLessThan(canvas.x)

    await page.keyboard.press('Tab')
    await expect(next).toBeFocused()
    await expect
      .poll(async () => {
        const box = (await next.boundingBox())!
        return box.x >= canvas.x && box.x + box.width <= canvas.x + canvas.width
      })
      .toBe(true)
  })

  test('режим «Страница»: слой холста не рисуется и камеры нет', async ({ page }) => {
    await openDocByTitle(page, 'Планирование Q4')
    await expect(page.locator('.cv.page')).toBeVisible()
    await expect(page.locator('.cv.page > .cv-world')).toHaveCSS('display', 'contents')
    await expect(page.locator('.cv.page > .cv-world')).toHaveCSS('transform', 'none')
  })
})

// ---- Масштаб холста: Ctrl + колесо, кнопки, «Показать всё», запоминание вида ----

const zoomGroup = (page: Page) => page.getByRole('group', { name: 'Масштаб холста' })
const percent = (page: Page, value: number) => zoomGroup(page).getByRole('button', { name: new RegExp(`^Масштаб ${value}%`) })

/** Колесо с зажатым Ctrl: так приходит и щипок на тачпаде. `steps` щелчков по 100 в сторону `deltaY`. */
async function ctrlWheel(page: Page, at: { x: number; y: number }, deltaY: number, steps = 1) {
  await page.mouse.move(at.x, at.y)
  await page.keyboard.down('Control')
  for (let i = 0; i < steps; i++) await page.mouse.wheel(0, deltaY)
  await page.keyboard.up('Control')
}

/** Сколько объекта лежит внутри окна холста; true, если целиком */
const insideCanvas = async (page: Page, el: Locator) => {
  const box = (await el.boundingBox())!
  const canvas = await canvasBox(page)
  return box.x >= canvas.x - 1 && box.y >= canvas.y - 1 && box.x + box.width <= canvas.x + canvas.width + 1 && box.y + box.height <= canvas.y + canvas.height + 1
}

test.describe('масштаб холста', () => {
  test('Ctrl + колесо приближает и отдаляет вокруг указателя: точка под ним остаётся на месте', async ({ page }) => {
    await openDocByTitle(page, 'Схема сервисов')
    const at = await center(named(page, 'Клиент'))
    const scrollY = await page.evaluate(() => window.scrollY)

    await ctrlWheel(page, at, -100)
    const zoomed = await cameraOf(page)
    expect(zoomed.z).toBeCloseTo(Math.exp(0.15), 4) // матрицу браузер отдаёт с шестью знаками
    // центр объекта, на который указывал курсор, остался под курсором
    const box = (await named(page, 'Клиент').boundingBox())!
    expect(Math.abs(box.x + box.width / 2 - at.x)).toBeLessThan(1)
    expect(Math.abs(box.y + box.height / 2 - at.y)).toBeLessThan(1)
    await expect(percent(page, 116)).toBeVisible()
    expect(await page.evaluate(() => window.scrollY), 'страница не прокрутилась').toBe(scrollY)

    // обратно тем же щелчком: масштаб снова 100%
    await ctrlWheel(page, at, 100)
    const back = await cameraOf(page)
    expect(back.z).toBeCloseTo(1, 4)
    expect(Math.abs(back.x)).toBeLessThan(1) // сдвиг рисуется в целых пикселях
    expect(Math.abs(back.y)).toBeLessThan(1)
  })

  test('масштаб держится между 25% и 200%, кнопки на пределе отключаются', async ({ page }) => {
    await openDocByTitle(page, 'Схема сервисов')
    const at = await center(named(page, 'Клиент'))
    await ctrlWheel(page, at, -100, 12)
    await expect.poll(async () => (await cameraOf(page)).z).toBe(2)
    await expect(percent(page, 200)).toBeVisible()
    await expect(zoomGroup(page).getByRole('button', { name: 'Увеличить' })).toBeDisabled()
    await expect(zoomGroup(page).getByRole('button', { name: 'Уменьшить' })).toBeEnabled()

    // pointer мог уехать за край: берём середину холста
    const box = await canvasBox(page)
    await ctrlWheel(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 100, 30)
    await expect.poll(async () => (await cameraOf(page)).z).toBe(0.25)
    await expect(percent(page, 25)).toBeVisible()
    await expect(zoomGroup(page).getByRole('button', { name: 'Уменьшить' })).toBeDisabled()
  })

  test('кнопки: «−» и «+» идут по ступеням, «100%» возвращает масштаб; середина окна остаётся на месте', async ({ page }) => {
    await openDocByTitle(page, 'Схема сервисов')
    const middle = async () => {
      const cam = await cameraOf(page)
      const view = await page.locator('.cv.edge').evaluate((el) => ({ w: el.clientWidth, h: el.clientHeight }))
      return { x: (view.w / 2 - cam.x) / cam.z, y: (view.h / 2 - cam.y) / cam.z }
    }
    const before = await middle()
    const minus = zoomGroup(page).getByRole('button', { name: 'Уменьшить' })
    const plus = zoomGroup(page).getByRole('button', { name: 'Увеличить' })
    await expect(percent(page, 100)).toBeVisible()

    await minus.click()
    await expect(percent(page, 75)).toBeVisible()
    await minus.click()
    await expect(percent(page, 67)).toBeVisible()
    await plus.click()
    await expect(percent(page, 75)).toBeVisible()
    await plus.click()
    await plus.click()
    await expect(percent(page, 125)).toBeVisible()
    const after = await middle()
    // сдвиг рисуется в целых пикселях, поэтому до пикселя (в координатах холста чуть больше при малом масштабе)
    expect(Math.abs(after.x - before.x)).toBeLessThan(1.5)
    expect(Math.abs(after.y - before.y)).toBeLessThan(1.5)

    await percent(page, 125).click() // «100%»: показывает нынешний, по нажатию возвращает 100%
    await expect(percent(page, 100)).toBeVisible()
    expect((await cameraOf(page)).z).toBe(1)
  })

  test('перенос на любом масштабе: объект идёт за указателем, на сервер числа холста, а не экрана', async ({ page }) => {
    const id = await openDocByTitle(page, 'Схема сервисов')
    const item = named(page, 'Клиент')
    let before = (await docFull(page, id)).objects.find((o) => o.text === 'Клиент')!

    for (const [deltaY, steps] of [[100, 5], [-100, 9]] as const) {
      // приближаем или отдаляем вокруг объекта: он остаётся под курсором и на виду
      const at = await center(item)
      await ctrlWheel(page, at, deltaY, steps)
      const z = (await cameraOf(page)).z
      const start = await center(item)
      const boxBefore = (await item.boundingBox())!
      await page.mouse.move(start.x, start.y)
      await page.mouse.down()
      await page.mouse.move(start.x + 100, start.y + 60, { steps: 6 })
      // на экране объект ушёл ровно за указателем
      const boxAfter = (await item.boundingBox())!
      expect(Math.round(boxAfter.x - boxBefore.x)).toBe(100)
      expect(Math.round(boxAfter.y - boxBefore.y)).toBe(60)
      await page.mouse.up()
      const expectedX = before.x + 100 / z
      const expectedY = before.y + 60 / z
      await expect
        .poll(async () => {
          const o = (await docFull(page, id)).objects.find((it) => it.text === 'Клиент')!
          return [Math.abs(o.x - expectedX) < 0.02, Math.abs(o.y - expectedY) < 0.02]
        })
        .toEqual([true, true])
      before = (await docFull(page, id)).objects.find((o) => o.text === 'Клиент')!
      // стрелки следуют за объектом и на любом масштабе
      await expect(lines(page)).toHaveCount(5)
    }
  })

  test('«Показать всё»: из любого места и масштаба всё содержимое целиком в окне', async ({ page }) => {
    await openDocByTitle(page, 'Схема сервисов')
    const at = await center(named(page, 'Клиент'))
    await ctrlWheel(page, at, -100, 8) // 200%
    await wheelOver(page, { x: 0, y: 2500 }, { shift: true }) // и далеко вбок: ничего не видно
    await expect.poll(async () => (await cameraOf(page)).z).toBe(2)
    expect(await insideCanvas(page, named(page, 'Клиент'))).toBe(false)

    await zoomGroup(page).getByRole('button', { name: 'Показать всё' }).click()
    const cam = await cameraOf(page)
    expect(cam.z).toBeLessThanOrEqual(1)
    expect(cam.z).toBeGreaterThanOrEqual(0.25)
    for (const el of await items(page).all()) expect(await insideCanvas(page, el)).toBe(true)
    expect(await insideCanvas(page, page.locator('.note.edge'))).toBe(true)
  })

  test('вид запоминается для документа и возвращается после перезапуска', async ({ page }) => {
    const id = await openDocByTitle(page, 'Схема сервисов')
    const at = await center(named(page, 'Клиент'))
    await ctrlWheel(page, at, -100, 3)
    await wheelOver(page, { x: 0, y: 80 })
    const shown = await cameraOf(page)
    expect(shown.z).toBeGreaterThan(1.4)
    // запись на диск идёт с паузой (400 мс на камеру и 300 мс на настройки)
    await expect
      .poll(() => page.evaluate((docId) => JSON.parse(localStorage.getItem('plexolab.settings') ?? '{}').canvasViews?.[docId] ?? null, id))
      .not.toBeNull()
    await page.waitForTimeout(500) // дальше не менялось: запись уже последняя

    await page.reload()
    await expect(page.locator('.cv.edge')).toBeVisible()
    const restored = await cameraOf(page)
    expect(restored.z).toBeCloseTo(shown.z, 2)
    expect(Math.abs(restored.x - shown.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(restored.y - shown.y)).toBeLessThanOrEqual(1)
  })

  test('другой документ открывается в своём виде: вид не общий', async ({ page }) => {
    await makeDoc(page, 'Пустая доска', 'edge')
    await openDocByTitle(page, 'Схема сервисов')
    const at = await center(named(page, 'Клиент'))
    await ctrlWheel(page, at, -100, 3)
    expect((await cameraOf(page)).z).toBeGreaterThan(1.4)

    await page.getByRole('button', { name: 'Все документы' }).click()
    await page.locator('.dgrid .dcard', { hasText: 'Пустая доска' }).click()
    await expect(page.locator('.cv.edge')).toBeVisible()
    expect(await cameraOf(page)).toEqual({ x: 0, y: 0, z: 1 })

    // и первый документ при возвращении стоит так, как его оставили
    await page.getByRole('button', { name: 'Все документы' }).click()
    await page.locator('.dgrid .dcard', { hasText: 'Схема сервисов' }).click()
    await expect(page.locator('.cv.edge')).toBeVisible()
    expect((await cameraOf(page)).z).toBeGreaterThan(1.4)
  })

  test('запомненный вид, где ничего не видно (содержимое убрали или сдвинули), не используется: холст с начала', async ({ page }) => {
    const id = await docId(page, 'Схема сервисов')
    await openApp(page, { settings: { page: 'docs', docOpen: id, canvasViews: { [id]: { x: -60000, y: -60000, z: 1 } } } })
    await expect(page.locator('.cv.edge')).toBeVisible()
    expect(await cameraOf(page)).toEqual({ x: 0, y: 0, z: 1 })
  })

  test('окно приложения целиком не масштабируется: Ctrl + колесо и Ctrl + «+», «−», «0» отменяются, обычное колесо нет', async ({ page }) => {
    await openDocByTitle(page, 'Схема сервисов')
    const prevented = await page.evaluate(() => {
      const bar = document.querySelector('.dbar')! // вне холста
      const wheel = new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true, bubbles: true })
      bar.dispatchEvent(wheel)
      const keys = ['=', '+', '-', '0'].map((key) => {
        const e = new KeyboardEvent('keydown', { key, ctrlKey: true, cancelable: true, bubbles: true })
        document.body.dispatchEvent(e)
        return e.defaultPrevented
      })
      const plain = new WheelEvent('wheel', { deltaY: 100, cancelable: true, bubbles: true })
      bar.dispatchEvent(plain)
      const typing = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, cancelable: true, bubbles: true })
      document.body.dispatchEvent(typing)
      return [wheel.defaultPrevented, ...keys, plain.defaultPrevented, typing.defaultPrevented]
    })
    expect(prevented).toEqual([true, true, true, true, true, false, false])
  })
})

// ---- Колесо над блоком со своей прокруткой: ось принадлежит блоку, холст не уносит ----

test.describe('колесо над широким блоком в карточке', () => {
  /** Документ-холст, где в карточке есть блок кода шире самой карточки (у него своя горизонтальная прокрутка) */
  async function openWide(page: Page) {
    const wide = 'const wide = "' + 'x'.repeat(220) + '"'
    const id = await makeDoc(page, 'Широкий код', 'edge', ['Короткий абзац.', '', '```', wide, '```', '', 'Хвост.'].join('\n'))
    await openDoc(page, id)
    const code = page.locator('.md-code')
    await expect(code).toBeVisible()
    expect(await code.evaluate((el) => el.scrollWidth > el.clientWidth + 50), 'блок шире карточки').toBe(true)
    const box = (await code.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    return { code, scrollLeft: () => code.evaluate((el) => el.scrollLeft), maxScroll: () => code.evaluate((el) => el.scrollWidth - el.clientWidth) }
  }

  test('Shift + колесо листает блок вбок, холст стоит', async ({ page }) => {
    const { scrollLeft } = await openWide(page)
    await page.keyboard.down('Shift')
    await page.mouse.wheel(0, 100)
    await page.keyboard.up('Shift')
    await expect.poll(scrollLeft).toBeGreaterThan(0)
    expect(await cameraOf(page)).toMatchObject({ x: 0, y: 0 })
  })

  test('горизонтальный жест (тачпад) листает блок, а когда блок кончился, остаток жеста холст не уносит', async ({ page }) => {
    const { scrollLeft, maxScroll } = await openWide(page)
    // жест заметно длиннее блока, как с инерцией тачпада: после края события идут дальше
    for (let i = 0; i < 40; i++) await page.mouse.wheel(60, 0)
    await expect.poll(async () => (await scrollLeft()) >= (await maxScroll()) - 1).toBe(true)
    for (let i = 0; i < 20; i++) await page.mouse.wheel(60, 0)
    await page.waitForTimeout(300)
    expect(await cameraOf(page), 'холст не сдвинулся').toMatchObject({ x: 0, y: 0 })

    // и в обратную сторону тоже: до начала блока и дальше
    for (let i = 0; i < 80; i++) await page.mouse.wheel(-60, 0)
    await expect.poll(scrollLeft).toBe(0)
    await page.waitForTimeout(300)
    expect(await cameraOf(page)).toMatchObject({ x: 0, y: 0 })
  })

  test('вертикальное колесо над таким блоком двигает холст (по вертикали блок не прокручивается), блок на месте', async ({ page }) => {
    const { scrollLeft } = await openWide(page)
    await page.mouse.wheel(0, 100)
    await expect.poll(async () => (await cameraOf(page)).y).toBe(-100)
    expect(await scrollLeft()).toBe(0)
  })

  test('над обычным текстом карточки колесо двигает холст', async ({ page }) => {
    await openWide(page)
    const text = (await page.locator('.note.edge').getByText('Короткий абзац.').boundingBox())!
    await page.mouse.move(text.x + 20, text.y + text.height / 2)
    await page.mouse.wheel(0, 80)
    await expect.poll(async () => (await cameraOf(page)).y).toBe(-80)
  })

  test('Shift + колесо над обычным текстом двигает холст по горизонтали', async ({ page }) => {
    await openWide(page)
    const text = (await page.locator('.note.edge').getByText('Короткий абзац.').boundingBox())!
    await page.mouse.move(text.x + 20, text.y + text.height / 2)
    await page.keyboard.down('Shift')
    await page.mouse.wheel(0, 90)
    await page.keyboard.up('Shift')
    await expect.poll(async () => (await cameraOf(page)).x).toBe(-90)
  })
})
