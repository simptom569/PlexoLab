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
