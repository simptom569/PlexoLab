import { expect, test, type Page } from '@playwright/test'
import { compareToReference, type Rect } from './compare'
import { docId, openDoc, openDocs } from './docs-helpers'
import { resetData } from './fixtures'
import { textRects } from './helpers'
import { MAX_DIFF_RATIO } from './tolerance'

// Всё правее бокового меню: меню сверяется отдельно (sidebar.spec.ts)
const MAIN: Rect = { x: 233, y: 0, width: 1207, height: 900 }

async function compare(page: Page, file: string, name: string, skip: Rect[] = []) {
  const actual = await page.screenshot({ clip: MAIN })
  const text = await textRects(page, MAIN)
  const { diffPixels, total, diffRatio } = compareToReference({ actual, referenceFile: file, region: MAIN, ignore: [...text, ...skip], name })
  console.log(`  ${name}: отличается ${diffPixels} из ${total} (${(diffRatio * 100).toFixed(3)}%), строк текста исключено: ${text.length}`)
  expect(diffRatio).toBeLessThan(MAX_DIFF_RATIO)
}

test.beforeEach(() => resetData())

// ===== Экраны 15–17: список документов, документ-страница, документ-холст =====

for (const theme of ['light', 'dark'] as const) {
  test.describe(`сверка экранов документов, ${theme === 'light' ? 'светлая' : 'тёмная'} тема`, () => {
    test(`15 список документов (${theme})`, async ({ page }) => {
      await openDocs(page, theme)
      await expect(page.locator('.dgrid .dcard')).toHaveCount(4)
      await page.mouse.move(800, 880)
      await compare(page, `15-docs-list-${theme}.png`, `15-docs-list-${theme}`)
    })

    test(`16 документ «Планирование Q4», страница (${theme})`, async ({ page }) => {
      await openDoc(page, await docId(page, 'Планирование Q4'), theme)
      await expect(page.locator('.md .mv')).toHaveCount(7)
      await page.mouse.move(800, 880)
      await compare(page, `16-doc-page-${theme}.png`, `16-doc-page-${theme}`)
    })

    test(`17 документ «Схема сервисов», холст (${theme})`, async ({ page }) => {
      await openDoc(page, await docId(page, 'Схема сервисов'), theme)
      await expect(page.locator('.cv .wb-item')).toHaveCount(7)
      await expect(page.locator('.cv .wb-line')).toHaveCount(5)
      await page.mouse.move(800, 880)
      // В эталоне (снят в Linux) текст шире на 4–8%: выноска в карточке с текстом переносится на лишнюю строку, и всё ниже
      // неё, вместе с нижним краем карточки, уезжает на строку вниз. Эта часть карточки не сравнивается, остальное да.
      await compare(page, `17-doc-canvas-${theme}.png`, `17-doc-canvas-${theme}`, [{ x: 55, y: 500, width: 412, height: 215 }])
    })
  })
}
