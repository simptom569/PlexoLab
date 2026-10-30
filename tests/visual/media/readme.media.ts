// Картинки для README: скриншоты экранов в обеих темах и короткий GIF (перенос карточки, панель задачи, тёмная тема).
// Запуск: `npm run readme-media` из корня репозитория. Результат — docs/screenshots/.
// Данные берутся из тестового стенда (макет, «сегодня» 18 октября 2026), поэтому картинки получаются одинаковыми при каждом запуске.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import gifenc from 'gifenc'
import pngjs from 'pngjs'
import { openDocByTitle } from '../docs-helpers'
import { openApp, resetData } from '../fixtures'
import { openWiki } from '../wiki-helpers'

const { PNG } = pngjs
const { applyPalette, GIFEncoder, quantize } = gifenc

const OUT = path.resolve(import.meta.dirname, '../../../docs/screenshots')
/** Ширина GIF: исходное окно 1440 пикселей, в README картинка всё равно показывается уже */
const GIF_WIDTH = 960

type Theme = 'light' | 'dark'

/** Убирает указатель с интерфейса, чтобы на снимке не было подсветки под мышью */
const park = (page: Page) => page.mouse.move(1430, 890)

type Shot = { name: string; open: (page: Page, theme: Theme) => Promise<void> }

const SHOTS: Shot[] = [
  { name: 'board', open: (page, theme) => openApp(page, { theme }) },
  { name: 'gantt', open: (page, theme) => openApp(page, { theme, settings: { view: 'gantt' } }) },
  {
    name: 'task',
    open: async (page, theme) => {
      await openApp(page, { theme })
      await page.getByRole('button', { name: 'Вход через SSO для корпоративных аккаунтов' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
    },
  },
  {
    name: 'backlog',
    open: async (page, theme) => {
      await openApp(page, { theme, settings: { page: 'backlog' } })
      await expect(page.locator('[data-row-id]')).toHaveCount(5)
    },
  },
  {
    name: 'releases',
    open: async (page, theme) => {
      await openApp(page, { theme, settings: { page: 'releases' } })
      await expect(page.getByRole('heading', { name: 'Релизы и вехи', level: 1 })).toBeVisible()
    },
  },
  {
    name: 'wiki',
    open: async (page, theme) => {
      await openWiki(page, 'Соглашения по коду', theme)
      await page.locator('.md .mv').first().click()
      await expect(page.locator('textarea.md-ta')).toBeFocused()
    },
  },
  { name: 'canvas', open: async (page, theme) => void (await openDocByTitle(page, 'Схема сервисов', theme)) },
]

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true })
})

for (const theme of ['light', 'dark'] as const) {
  test.describe(`снимки, ${theme}`, () => {
    test.beforeAll(() => resetData())

    for (const shot of SHOTS) {
      test(`${shot.name}-${theme}`, async ({ page }) => {
        await shot.open(page, theme)
        await park(page)
        // анимации выключены настройкой браузера (reducedMotion), но подсказкам и фокусу нужен кадр, чтобы осесть
        await page.waitForTimeout(300)
        writeFileSync(path.join(OUT, `${shot.name}-${theme}.png`), await page.screenshot())
      })
    }
  })
}

// ----- GIF -----

/** Уменьшает кадр средним по площади: текст остаётся читаемым и не рябит */
function downscale(src: InstanceType<typeof PNG>, width: number): { data: Uint8Array; width: number; height: number } {
  const k = src.width / width
  const height = Math.round(src.height / k)
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const y0 = y * k
    const y1 = Math.min(src.height, y0 + k)
    for (let x = 0; x < width; x++) {
      const x0 = x * k
      const x1 = Math.min(src.width, x0 + k)
      let r = 0
      let g = 0
      let b = 0
      let weight = 0
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0)
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const w = wy * (Math.min(sx + 1, x1) - Math.max(sx, x0))
          const i = (sy * src.width + sx) * 4
          r += src.data[i] * w
          g += src.data[i + 1] * w
          b += src.data[i + 2] * w
          weight += w
        }
      }
      const o = (y * width + x) * 4
      out[o] = Math.round(r / weight)
      out[o + 1] = Math.round(g / weight)
      out[o + 2] = Math.round(b / weight)
      out[o + 3] = 255
    }
  }
  return { data: out, width, height }
}

async function center(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox()
  expect(box, selector).not.toBeNull()
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2, box: box! }
}

test('demo.gif: перенос карточки, панель задачи, тёмная тема', async ({ page }) => {
  test.setTimeout(180_000)
  resetData()
  const frames: Array<{ png: Buffer; delay: number }> = []
  const grab = async (delay: number) => {
    frames.push({ png: await page.screenshot(), delay })
  }

  await openApp(page, { theme: 'light' })
  await park(page)
  await page.waitForTimeout(300)
  await grab(1200)

  // берём карточку и несём её в колонку «На ревью»
  const from = await center(page, '[data-card-id]:has-text("WEB-151")')
  const target = await center(page, '[data-card-id]:has-text("WEB-137")')
  const to = { x: target.x, y: target.box.y + 20 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 3 })
  await grab(120)
  const steps = 14
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const e = t * t * (3 - 2 * t) // плавный разгон и торможение
    await page.mouse.move(from.x + 8 + (to.x - from.x - 8) * e, from.y + 8 + (to.y - from.y - 8) * e)
    await page.waitForTimeout(30)
    await grab(70)
  }
  await grab(500)
  await page.mouse.up()
  await page.waitForTimeout(250)
  await park(page)
  await grab(900)

  // открываем задачу
  await page.locator('[data-card-id]:has-text("WEB-151")').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await park(page)
  await page.waitForTimeout(300)
  await grab(1600)

  // переключаем тему так, как это делает человек: меню на карточке пользователя (подложка панели перехватывает клики, поэтому панель закрываем)
  await page.getByRole('button', { name: 'Закрыть задачу' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.locator('button[aria-haspopup="menu"]', { hasText: 'Лена М.' }).click()
  await page.waitForTimeout(150)
  await grab(900)
  await page.getByRole('menuitem', { name: 'Тёмная тема' }).click()
  await page.mouse.move(800, 600)
  await page.waitForTimeout(300)
  await grab(1800)

  // MEDIA_FRAMES=1: сложить кадры PNG в output/media/frames, чтобы посмотреть их глазами (папка не попадает в git)
  if (process.env.MEDIA_FRAMES) {
    const dir = path.resolve(import.meta.dirname, '../output/media/frames')
    mkdirSync(dir, { recursive: true })
    frames.forEach((frame, i) => writeFileSync(path.join(dir, `${String(i).padStart(2, '0')}.png`), frame.png))
  }

  const gif = GIFEncoder()
  for (const frame of frames) {
    const { data, width, height } = downscale(PNG.sync.read(frame.png), GIF_WIDTH)
    const palette = quantize(data, 256)
    gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay: frame.delay })
  }
  gif.finish()
  writeFileSync(path.join(OUT, 'demo.gif'), gif.bytes())
  console.log(`  demo.gif: ${frames.length} кадров, ${(gif.bytes().length / 1024 / 1024).toFixed(2)} МБ`)
})
