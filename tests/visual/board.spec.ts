import { expect, test, type Page } from '@playwright/test'
import { compareToReference, referenceLines, type Rect } from './compare'
import { openApp, resetData } from './fixtures'
import { textRects } from './helpers'
import { MAX_DIFF_RATIO } from './tolerance'

// Всё правее бокового меню: меню сверяется отдельно (sidebar.spec.ts), в нём иконка и карточка пользователя отличаются от эталона
const MAIN: Rect = { x: 233, y: 0, width: 1207, height: 900 }

type Screen = {
  file: string
  view: 'board' | 'list' | 'table' | 'cal' | 'gantt'
  /** Что сделать, чтобы экран стал таким, как на эталоне */
  prepare?: (page: Page) => Promise<void>
}

const SCREENS: Screen[] = [
  { file: '01-board', view: 'board' },
  { file: '02-board-list', view: 'list' },
  { file: '03-board-table', view: 'table' },
  { file: '04-board-calendar', view: 'cal' },
  { file: '05-board-gantt', view: 'gantt' },
  { file: '06-board-filters', view: 'board', prepare: (page) => page.getByRole('button', { name: /^Фильтры/ }).click() },
  { file: '07-board-display', view: 'board', prepare: (page) => page.getByRole('button', { name: 'Отображение' }).click() },
  { file: '08-task-drawer', view: 'board', prepare: (page) => page.getByRole('button', { name: 'Вход через SSO для корпоративных аккаунтов' }).click() },
]

test.beforeAll(() => resetData())

// Строки таблицы сверяются по одной: в эталоне (Linux) текст шире на 4–8%, поэтому заголовок «Ошибка 500 при пустом профиле»
// перенесён на вторую строку, а у нас помещается в одну, и все строки ниже сдвигаются. Строки разной высоты пикселями не сравниваются.
const TABLE_X = 36
const TABLE_W = 1134
const MAX_ROWS_WRAPPED_DIFFERENTLY = 2
// Округление высоты строки (line-height 1.4 × 14px) в разных движках даёт до пары пикселей; перенос строки текста даёт около 20
const ROW_HEIGHT_SLACK = 4

async function compareTable(page: Page, theme: string, file: string) {
  const head = await page.locator('.trow.thead').boundingBox()
  const rows = await page.locator('.trow:not(.thead)').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return { top: Math.round(r.top), height: Math.round(r.height) }
    }),
  )
  expect(head, 'шапка таблицы').not.toBeNull()
  const headBottom = Math.round(head!.y + head!.height)

  // верх страницы до шапки таблицы включительно
  const top: Rect = { x: MAIN.x, y: 0, width: MAIN.width, height: headBottom }
  const topShot = await page.screenshot({ clip: top })
  const topText = await textRects(page, top)
  const topResult = compareToReference({ actual: topShot, referenceFile: file, region: top, ignore: topText, name: `${file.replace('.png', '')}-top` })

  // границы строк в эталоне: линии под шапкой и под каждой строкой
  const lines = referenceLines(file, MAIN.x + TABLE_X + TABLE_W - 12, headBottom - 6, 880)
  expect(lines.length, 'линий-границ строк в эталоне: шапка, 12 строк').toBeGreaterThanOrEqual(rows.length + 1)
  let diff = topResult.diffPixels
  let total = topResult.total
  let skipped = 0
  for (const [i, row] of rows.entries()) {
    // строка начинается с верхней границы (линия-разделитель принадлежит строке)
    const refTop = lines[i]!
    const refHeight = lines[i + 1]! - refTop
    if (Math.abs(refHeight - row.height) > ROW_HEIGHT_SLACK) {
      skipped++
      continue
    }
    const height = Math.min(refHeight, row.height)
    const region: Rect = { x: MAIN.x + TABLE_X, y: refTop, width: TABLE_W, height }
    const clip: Rect = { x: MAIN.x + TABLE_X, y: row.top, width: TABLE_W, height }
    const text = await textRects(page, clip)
    const r = compareToReference({
      actual: await page.screenshot({ clip }),
      referenceFile: file,
      region,
      ignore: text.map((t) => ({ ...t })),
      name: `${file.replace('.png', '')}-row${i}`,
    })
    diff += r.diffPixels
    total += r.total
  }
  console.log(`  ${file} (${theme}): строк ${rows.length}, другой высоты, чем в эталоне: ${skipped}; отличается ${diff} из ${total} (${((diff / total) * 100).toFixed(3)}%)`)
  expect(skipped, 'строк другой высоты').toBeLessThanOrEqual(MAX_ROWS_WRAPPED_DIFFERENTLY)
  expect(rows.length).toBeGreaterThan(0)
  expect(diff / total).toBeLessThan(MAX_DIFF_RATIO)
}

for (const theme of ['light', 'dark'] as const) {
  for (const screen of SCREENS) {
    test(`${screen.file}: ${theme}`, async ({ page }) => {
      await openApp(page, { theme, settings: { view: screen.view } })
      await expect(page.getByRole('heading', { name: 'Доска', level: 1 })).toBeVisible()
      await expect(page.locator('.main')).toBeVisible()
      await screen.prepare?.(page)
      await page.mouse.move(1000, 880)
      await page.waitForTimeout(150)

      if (screen.view === 'table') return compareTable(page, theme, `${screen.file}-${theme}.png`)

      const actual = await page.screenshot({ clip: MAIN })
      const text = await textRects(page, MAIN)
      const { diffPixels, total, diffRatio } = compareToReference({
        actual,
        referenceFile: `${screen.file}-${theme}.png`,
        region: MAIN,
        ignore: text,
        name: `${screen.file}-${theme}`,
      })
      console.log(`  ${screen.file} ${theme}: отличается ${diffPixels} из ${total} (${(diffRatio * 100).toFixed(3)}%), строк текста исключено: ${text.length}`)
      expect(diffRatio).toBeLessThan(MAX_DIFF_RATIO)
    })
  }
}

// Доска-канбан прокручивается до краёв рабочей области (app/src/styles/board.css): обёртка колонок вылезает за боковой
// отступ .main и возвращает его внутрь. В покое колонки стоят как в макете, в конце прокрутки справа тот же отступ.
test.describe('доска прокручивается до краёв рабочей области', () => {
  const geometry = (page: Page) =>
    page.evaluate(() => {
      const main = document.querySelector('main.main')!
      const scroller = main.querySelector<HTMLElement>('.kanban-scroll')!
      const columns = [...scroller.querySelectorAll('section.col, .col-new')].map((c) => c.getBoundingClientRect())
      const box = scroller.getBoundingClientRect()
      const area = main.getBoundingClientRect()
      return {
        pad: parseFloat(getComputedStyle(main).paddingLeft),
        mainLeft: area.left,
        mainRight: area.right,
        left: box.left,
        right: box.right,
        firstColumnLeft: columns[0].left,
        lastColumnRight: columns[columns.length - 1].right,
        scrollable: scroller.scrollWidth - scroller.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      }
    })
  const near = (actual: number, expected: number) => expect(Math.abs(actual - expected), `${actual} против ${expected}`).toBeLessThanOrEqual(1)

  for (const width of [1440, 1100]) {
    test(`окно ${width} px: обёртка до краёв, в покое отступ слева, в конце прокрутки отступ справа`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openApp(page)

      const rest = await geometry(page)
      expect(rest.scrollable, 'колонки не помещаются, прокрутка есть').toBeGreaterThan(0)
      near(rest.left, rest.mainLeft)
      near(rest.right, rest.mainRight)
      near(rest.firstColumnLeft, rest.mainLeft + rest.pad)
      expect(rest.pageOverflow, 'у всей страницы прокрутки по горизонтали нет').toBeLessThanOrEqual(0)

      await page.locator('.kanban-scroll').evaluate((el) => (el.scrollLeft = el.scrollWidth))
      const end = await geometry(page)
      near(end.lastColumnRight, end.mainRight - end.pad)
      expect(end.pageOverflow).toBeLessThanOrEqual(0)
    })
  }

  test('в списке обёртки нет: другие виды не затронуты', async ({ page }) => {
    await openApp(page, { settings: { view: 'list' } })
    await expect(page.locator('.kanban-scroll')).toHaveCount(0)
  })
})
