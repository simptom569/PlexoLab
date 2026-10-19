import { expect, test } from '@playwright/test'
import { compareToReference, type Rect } from './compare'
import { openApp } from './fixtures'
import { MAX_DIFF_RATIO } from './tolerance'
import { textRects } from './helpers'

// Боковое меню эталона 01 (доска). Берём верх до конца списка проектов: карточка пользователя
// в эталоне ниже границы экрана (там min-height 1380px), а в приложении она прижата к низу окна.
const SIDEBAR: Rect = { x: 0, y: 0, width: 233, height: 560 }
// Вместо пунктирной заглушки эталона в приложении стоит иконка PlexoLab (CLAUDE.md, раздел «Бренд»)
const BRAND_ICON: Rect = { x: 20, y: 22, width: 32, height: 32 }

const NAV_TEXTS = ['Доска', 'Бэклог', 'Модули', 'Релизы и вехи', 'Вики', 'Документы', 'Активность', 'Ссылки команды']
const PROJECT_TEXTS = ['Web-приложение', 'Мобильный API', 'Инфраструктура']

for (const theme of ['light', 'dark'] as const) {
  test.describe(`тема: ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await openApp(page, { theme })
      await expect(page.getByRole('button', { name: 'Web-приложение' })).toBeVisible()
      await expect(page.locator('.side .count')).toHaveText('5') // счётчик бэклога пришёл с сервера
    })

    test('AppShell и Sidebar совпадают с эталоном 01 (без пикселей текста)', async ({ page }) => {
      await page.mouse.move(800, 600)
      const actual = await page.screenshot({ clip: SIDEBAR })
      const text = await textRects(page, SIDEBAR)
      const { diffPixels, total, diffRatio } = compareToReference({
        actual,
        referenceFile: `01-board-${theme}.png`,
        region: SIDEBAR,
        ignore: [BRAND_ICON, ...text],
        name: `sidebar-${theme}`,
      })
      console.log(`  ${theme}: отличается ${diffPixels} из ${total} пикселей (${(diffRatio * 100).toFixed(3)}%), строк текста исключено: ${text.length}`)
      expect(diffRatio).toBeLessThan(MAX_DIFF_RATIO)
    })

    test('тексты и разметка сайдбара как в макете', async ({ page }) => {
      const nav = page.getByRole('navigation', { name: 'Основная навигация' })
      await expect(nav.getByRole('button')).toHaveText(NAV_TEXTS.map((t) => (t === 'Бэклог' ? /^Бэклог\s*5$/ : t)))
      await expect(nav.getByRole('button', { name: 'Доска' })).toHaveAttribute('aria-current', 'page')
      await expect(nav.getByRole('button', { name: 'Вики' })).toHaveAttribute('aria-current', 'false')

      const projects = page.getByRole('navigation', { name: 'Проекты' })
      await expect(projects.getByRole('button')).toHaveText(PROJECT_TEXTS)
      await expect(projects.getByRole('button', { name: 'Web-приложение' })).toHaveClass(/\bcur\b/)

      await expect(page.locator('.side strong').first()).toHaveText('PlexoLab')
      await expect(page.getByText('Рабочее пространство')).toBeVisible()
      await expect(page.getByRole('button', { name: /Лена М\.\s*Frontend/ })).toBeVisible()
    })
  })
}
