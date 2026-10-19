import { expect, test } from '@playwright/test'
import { settle } from './helpers'

// Снимки витрины компонентов (/showcase) в обеих темах. Окно 1440×900.
// Обновить эталоны после намеренных изменений: npm run update-visual

for (const theme of ['light', 'dark'] as const) {
  test(`витрина компонентов (${theme})`, async ({ page }) => {
    await page.goto(`/showcase?theme=${theme}`)
    await settle(page)
    await expect(page).toHaveScreenshot(`showcase-${theme}.png`, { fullPage: true })
  })
}
