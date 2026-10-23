import { expect, test, type Page } from '@playwright/test'
import { docFull, makeDoc, openDoc } from './docs-helpers'
import { openApp, resetData } from './fixtures'
import { blocks, editor, makePage, openPageById, wikiPage } from './wiki-helpers'

// «+» между блоками (в макете его нет): при наведении на промежуток виден круг с плюсом и линия, нажатие вставляет пустой
// блок на это место. Выше первого блока вставить можно только так. Полоса лежит в промежутке и вёрстку не двигает.

test.beforeEach(() => resetData())

const THREE = 'Первый абзац\n\nВторой абзац\n\nТретий абзац'

type Kit = {
  name: string
  create: (page: Page, md: string) => Promise<string>
  open: (page: Page, id: string) => Promise<void>
  md: (page: Page, id: string) => Promise<string>
}

const wiki: Kit = {
  name: 'вики',
  create: (page, md) => makePage(page, 'Плюс', md),
  open: (page, id) => openPageById(page, id),
  md: async (page, id) => (await wikiPage(page, id)).md,
}

const docs: Kit = {
  name: 'документы',
  create: (page, md) => makeDoc(page, 'Плюс', 'page', md),
  open: (page, id) => openDoc(page, id),
  md: async (page, id) => (await docFull(page, id)).md,
}

/** Обёртки блоков редактора (в том числе открытого поля), по одной на блок: у каждой в начале свой промежуток */
const wrappers = (page: Page) => page.locator('.md > div:not(.md-add):not(.pm-slot)')

/** Точка в промежутке перед k-м блоком: чуть выше его верхней границы */
async function gapPoint(page: Page, k: number) {
  const box = (await wrappers(page).nth(k).boundingBox())!
  return { x: box.x + box.width / 2, y: box.y - 1 }
}

async function hoverGap(page: Page, k: number) {
  const { x, y } = await gapPoint(page, k)
  await page.mouse.move(x, y)
}

async function clickGap(page: Page, k: number) {
  const { x, y } = await gapPoint(page, k)
  await page.mouse.click(x, y)
}

const pseudoOpacity = (page: Page, k: number) =>
  wrappers(page)
    .nth(k)
    .locator('.md-gap')
    .evaluate((el) => getComputedStyle(el, '::before').opacity)

for (const kit of [wiki, docs]) {
  test.describe(kit.name, () => {
    test('«+» не виден, пока мышь не в промежутке; при наведении появляются круг с плюсом и линия', async ({ page }) => {
      const id = await kit.create(page, THREE)
      await kit.open(page, id)
      await page.mouse.move(5, 5)
      await expect(wrappers(page).nth(1).locator('.md-gap-plus')).toHaveCSS('opacity', '0')
      expect(await pseudoOpacity(page, 1)).toBe('0')

      await hoverGap(page, 1)
      await expect(wrappers(page).nth(1).locator('.md-gap-plus')).toHaveCSS('opacity', '1')
      await expect(wrappers(page).nth(1).locator('.md-gap-plus')).toHaveText('+')
      expect(await pseudoOpacity(page, 1)).toBe('1')
      // остальные промежутки по-прежнему скрыты
      await expect(wrappers(page).nth(2).locator('.md-gap-plus')).toHaveCSS('opacity', '0')
    })

    test('наведение вёрстку не двигает: блоки стоят там же', async ({ page }) => {
      const id = await kit.create(page, THREE)
      await kit.open(page, id)
      const before = await blocks(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top))
      await hoverGap(page, 1)
      await expect(wrappers(page).nth(1).locator('.md-gap-plus')).toHaveCSS('opacity', '1')
      const after = await blocks(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top))
      expect(after).toEqual(before)
    })

    test('нажатие между блоками вставляет пустой блок на это место, открывает его, текст сохраняется', async ({ page }) => {
      const id = await kit.create(page, THREE)
      await kit.open(page, id)
      await clickGap(page, 1)
      await expect(editor(page)).toBeFocused()
      await expect(editor(page)).toHaveValue('')
      // поле встало между первым и вторым абзацем
      await expect(page.locator('.md > div:not(.md-add)')).toHaveCount(4)
      await expect(page.locator('.md > div').nth(1).locator('textarea.md-ta')).toHaveCount(1)

      await page.keyboard.type('Вставка')
      await page.keyboard.press('Escape')
      await expect.poll(() => kit.md(page, id), { timeout: 6000 }).toBe('Первый абзац\n\nВставка\n\nВторой абзац\n\nТретий абзац')
      await expect(blocks(page)).toHaveText(['Первый абзац', 'Вставка', 'Второй абзац', 'Третий абзац'])
    })

    test('выше первого блока: единственный способ вставить блок в начало', async ({ page }) => {
      const id = await kit.create(page, THREE)
      await kit.open(page, id)
      await clickGap(page, 0)
      await expect(editor(page)).toBeFocused()
      await expect(editor(page)).toHaveValue('')
      await page.keyboard.type('Новое начало')
      await page.keyboard.press('Escape')
      await expect.poll(() => kit.md(page, id), { timeout: 6000 }).toBe('Новое начало\n\nПервый абзац\n\nВторой абзац\n\nТретий абзац')
      await expect(blocks(page).first()).toHaveText('Новое начало')
    })

    test('оставили блок пустым: после выхода текст такой же, как был, без пустых строк', async ({ page }) => {
      const id = await kit.create(page, THREE)
      await kit.open(page, id)
      await clickGap(page, 2)
      await expect(editor(page)).toHaveValue('')
      await page.keyboard.press('Escape')
      await expect(editor(page)).toHaveCount(0)
      await page.waitForTimeout(1200) // на сервере остаётся прежний текст
      expect(await kit.md(page, id)).toBe(THREE)
      await expect(blocks(page)).toHaveText(['Первый абзац', 'Второй абзац', 'Третий абзац'])
    })

    test('пока открыт другой блок, «+» сохраняет написанное в нём и открывает новый', async ({ page }) => {
      const id = await kit.create(page, THREE)
      await kit.open(page, id)
      await blocks(page).nth(0).click()
      await page.keyboard.type(' (правка)')
      await clickGap(page, 1)
      await expect(editor(page)).toHaveValue('')
      await page.keyboard.type('Между')
      await page.keyboard.press('Escape')
      await expect.poll(() => kit.md(page, id), { timeout: 6000 }).toBe('Первый абзац (правка)\n\nМежду\n\nВторой абзац\n\nТретий абзац')
    })

    test('нажатие внутри блока открывает его, как раньше: полоса промежутка текст не перехватывает', async ({ page }) => {
      const id = await kit.create(page, THREE)
      await kit.open(page, id)
      const box = (await blocks(page).nth(1).boundingBox())!
      // у самого верхнего и нижнего края блока, но внутри него (3px отступа): это ещё блок, а не промежуток
      await page.mouse.click(box.x + box.width / 2, box.y + 5)
      await expect(editor(page)).toHaveValue('Второй абзац')
    })
  })
}

test('второй человек видит вставку между блоками как «добавляет блок», а потом как блок с текстом', async ({ page, browser }) => {
  const id = await wiki.create(page, THREE)
  await wiki.open(page, id)
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU', timezoneId: 'UTC', reducedMotion: 'reduce' })
  const artem = await context.newPage()
  try {
    await openApp(artem, { email: 'artem@example.com', settings: { page: 'wiki', wikiPage: id, live: true } })
    await expect(artem.getByLabel('Название страницы')).toBeVisible()

    await clickGap(page, 1)
    await expect(editor(page)).toHaveValue('')
    await expect(artem.locator('.md .pm-slot')).toHaveCount(1, { timeout: 6000 })
    await expect(artem.locator('.md .pm-slot')).toContainText('добавляет блок')

    await page.keyboard.type('Вставка')
    await expect(artem.locator('.md .pm-slot')).toHaveCount(0, { timeout: 6000 })
    await expect(artem.locator('.md .mv.pm')).toContainText('Вставка')
  } finally {
    await context.close()
  }
})

// Снимки наведения на промежуток в обеих темах (эталонов макета нет)
for (const theme of ['light', 'dark'] as const) {
  test(`снимок: «+» при наведении на промежуток (${theme})`, async ({ page }) => {
    const id = await wiki.create(page, THREE)
    await openPageById(page, id, theme)
    await hoverGap(page, 1)
    await expect(wrappers(page).nth(1).locator('.md-gap-plus')).toHaveCSS('opacity', '1')
    const box = (await page.locator('.md').boundingBox())!
    await expect(page).toHaveScreenshot(`gap-add-${theme}.png`, {
      clip: { x: box.x - 14, y: box.y - 14, width: box.width + 28, height: 150 },
    })
  })
}
