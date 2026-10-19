import type { Page } from '@playwright/test'
import type { Rect } from './compare'

/** Ждёт, пока страница загрузится и подгрузятся шрифты Manrope и JetBrains Mono */
export async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(async () => {
    await document.fonts.load("400 14px 'Manrope'")
    await document.fonts.load("600 14px 'Manrope'")
    await document.fonts.load("700 14px 'Manrope'")
    await document.fonts.ready
  })
}

/**
 * Прямоугольники всех строк текста внутри области (в координатах области).
 * Эталон снят в Chromium на Linux: там текст чуть шире (целые пиксели метрик шрифта), чем в Chromium на Windows.
 * Поэтому пиксели текста в сравнении не участвуют, а сами строки проверяются по DOM отдельно.
 */
export async function textRects(page: Page, region: Rect): Promise<Rect[]> {
  return page.evaluate((reg) => {
    const out: Rect[] = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const r of Array.from(range.getClientRects())) {
        if (r.width < 2 || r.height < 2) continue
        // запас: ширина текста эталона больше на 4–8%, глифы могут отличаться по высоте на пиксель
        const x0 = Math.max(reg.x, Math.floor(r.left - 1))
        const y0 = Math.max(reg.y, Math.floor(r.top - 1))
        const x1 = Math.min(reg.x + reg.width, Math.ceil(r.right + Math.max(4, r.width * 0.08)))
        const y1 = Math.min(reg.y + reg.height, Math.ceil(r.bottom + 1))
        if (x1 > x0 && y1 > y0) out.push({ x: x0 - reg.x, y: y0 - reg.y, width: x1 - x0, height: y1 - y0 })
      }
    }
    return out
  }, region)
}

/** Включает тёмную тему так, как это делает пользователь: меню на карточке пользователя */
export async function switchToDark(page: Page) {
  await page.getByRole('button', { name: /Лена М\./ }).click()
  await page.getByRole('menuitem', { name: 'Тёмная тема' }).click()
  await page.mouse.move(800, 600)
}
