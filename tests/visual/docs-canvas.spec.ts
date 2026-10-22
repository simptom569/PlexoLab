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
