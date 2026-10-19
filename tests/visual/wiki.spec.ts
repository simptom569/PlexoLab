import { expect, test, type Page } from '@playwright/test'
import { compareToReference, type Rect } from './compare'
import { resetData } from './fixtures'
import { textRects } from './helpers'
import { MAX_DIFF_RATIO } from './tolerance'
import { openWiki } from './wiki-helpers'

// Всё правее бокового меню: меню сверяется отдельно (sidebar.spec.ts)
const MAIN: Rect = { x: 233, y: 0, width: 1207, height: 900 }

async function compare(page: Page, file: string, name: string) {
  const actual = await page.screenshot({ clip: MAIN })
  const text = await textRects(page, MAIN)
  const { diffPixels, total, diffRatio } = compareToReference({ actual, referenceFile: file, region: MAIN, ignore: text, name })
  console.log(`  ${name}: отличается ${diffPixels} из ${total} (${(diffRatio * 100).toFixed(3)}%), строк текста исключено: ${text.length}`)
  expect(diffRatio).toBeLessThan(MAX_DIFF_RATIO)
}

test.beforeEach(() => resetData())

// ===== Экраны 12–14: вики, активный блок, файлы =====

for (const theme of ['light', 'dark'] as const) {
  test.describe(`сверка экранов вики, ${theme === 'light' ? 'светлая' : 'тёмная'} тема`, () => {
    test(`12 страница «Соглашения по коду» (${theme})`, async ({ page }) => {
      await openWiki(page, 'Соглашения по коду', theme)
      await expect(page.locator('.md .mv')).toHaveCount(7)
      await page.mouse.move(800, 880)
      await compare(page, `12-wiki-page-${theme}.png`, `12-wiki-page-${theme}`)
    })

    test(`13 активный блок (${theme})`, async ({ page }) => {
      await openWiki(page, 'Соглашения по коду', theme)
      await page.locator('.md .mv').first().click()
      await expect(page.locator('textarea.md-ta')).toBeFocused()
      await page.mouse.move(800, 880)
      await compare(page, `13-wiki-edit-${theme}.png`, `13-wiki-edit-${theme}`)
    })

    test(`14 файлы (${theme})`, async ({ page }) => {
      await openWiki(page, 'Соглашения по коду', theme)
      await page.getByRole('button', { name: /^Файлы/ }).click()
      await expect(page.locator('.folder')).toHaveCount(4)
      await page.mouse.move(800, 880)
      await compare(page, `14-wiki-files-${theme}.png`, `14-wiki-files-${theme}`)
    })
  })
}
