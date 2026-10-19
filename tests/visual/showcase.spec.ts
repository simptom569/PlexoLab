import { expect, test } from '@playwright/test'
import { settle, switchToDark } from './helpers'

// Снимки витрины компонентов (/showcase) и каркаса приложения в обеих темах. Окно 1440×900.
// Обновить эталоны после намеренных изменений: npm run update

for (const theme of ['light', 'dark'] as const) {
  test(`витрина компонентов (${theme})`, async ({ page }) => {
    await page.goto(`/showcase?theme=${theme}`)
    await settle(page)
    await expect(page).toHaveScreenshot(`showcase-${theme}.png`, { fullPage: true })
  })

  test(`каркас приложения (${theme})`, async ({ page }) => {
    await page.goto('/')
    if (theme === 'dark') await switchToDark(page)
    await settle(page)
    await expect(page).toHaveScreenshot(`shell-${theme}.png`)
  })
}
