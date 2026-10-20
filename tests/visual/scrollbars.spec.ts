import { expect, test, type Page } from '@playwright/test'
import pngjs from 'pngjs'

const { PNG } = pngjs

// Режимы полос прокрутки по настоящим пикселям. В headless Chromium полосы по умолчанию скрыты (--hide-scrollbars),
// поэтому здесь они включены. Страница — витрина (/showcase), бэкенд не нужен. Цвета тёмной темы из scrollbar.css.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] }, viewport: { width: 1440, height: 700 } })

const TRACK = '#0e1014' // --bg: дорожка и прозрачный ползунок
const THUMB = '#3a4150' // --line-strong
const HOVER = '#9aa3b5' // --muted
const ACTIVE = '#8fa5ff' // --accent

async function open(page: Page, scrollbars: 'visible' | 'quiet' | 'hidden') {
  await page.addInitScript((mode) => localStorage.setItem('plexolab.settings', JSON.stringify({ scrollbars: mode, theme: 'dark' })), scrollbars)
  await page.goto('/showcase?theme=dark')
  await expect(page.locator('html')).toHaveAttribute('data-scrollbars', scrollbars)
  await expect(page.locator('.app').first()).toBeVisible()
}

async function pixel(page: Page, x: number, y: number) {
  const png = PNG.sync.read(await page.screenshot())
  const i = (y * png.width + x) * 4
  return '#' + [0, 1, 2].map((k) => png.data[i + k]!.toString(16).padStart(2, '0')).join('')
}

/** Центр ползунка окна по текущей прокрутке (точка внутри полосы по высоте) */
const windowThumb = (page: Page) =>
  page.evaluate(() => {
    const h = window.innerHeight
    const total = document.documentElement.scrollHeight
    const length = Math.max(40, (h * h) / total)
    return { x: document.documentElement.clientWidth + 6, y: Math.round((window.scrollY / (total - h)) * (h - length) + length / 2) }
  })

const thumbColor = async (page: Page) => {
  const { x, y } = await windowThumb(page)
  return pixel(page, x, y)
}

async function scrollWindow(page: Page) {
  await page.mouse.move(700, 300)
  await page.mouse.wheel(0, 300)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300)
}

/** Прокручиваемый блок поверх страницы: у него своя полоса */
async function addScroller(page: Page) {
  await page.evaluate(() => {
    const box = document.createElement('div')
    box.id = 'probe'
    box.className = 'dr-body'
    box.style.cssText = 'position:fixed;left:40px;top:40px;width:400px;height:160px;z-index:99;background:var(--surface);border:1px solid var(--line)'
    box.innerHTML = Array.from({ length: 14 }, (_, i) => `<div>Строка ${i + 1}</div>`).join('')
    document.querySelector('.app')!.append(box)
  })
  return page.evaluate(() => {
    const r = document.getElementById('probe')!.getBoundingClientRect()
    return { x: Math.round(r.right - 1 - 6), y: Math.round(r.top + 1 + 20), inside: { x: 200, y: 100 } }
  })
}

test.describe('видимые', () => {
  test('ползунок виден всегда, при наведении светлее, при перетаскивании цвета акцента', async ({ page }) => {
    await open(page, 'visible')
    expect(await thumbColor(page)).toBe(THUMB)
    const { x, y } = await windowThumb(page)
    await page.mouse.move(x, y)
    await expect.poll(() => pixel(page, x, y)).toBe(HOVER)
    await page.mouse.down()
    await expect.poll(() => pixel(page, x, y)).toBe(ACTIVE)
    await page.mouse.up()
  })
})

test.describe('тихие', () => {
  test('окно: в покое не видно, при прокрутке появляется и гаснет, над ползунком виден', async ({ page }) => {
    await open(page, 'quiet')
    expect(await thumbColor(page)).toBe(TRACK)

    await scrollWindow(page)
    expect(await thumbColor(page)).toBe(THUMB)
    await expect.poll(() => thumbColor(page), { timeout: 3000 }).toBe(TRACK)

    const { x, y } = await windowThumb(page)
    await page.mouse.move(x, y)
    await expect.poll(() => pixel(page, x, y)).toBe(HOVER)
    await page.mouse.down()
    await expect.poll(() => pixel(page, x, y)).toBe(ACTIVE)
    await page.mouse.up()
  })

  test('вложенный блок: полоса видна, пока курсор над блоком, и пропадает, когда он ушёл', async ({ page }) => {
    await open(page, 'quiet')
    const probe = await addScroller(page)
    await page.mouse.move(900, 400)
    await expect.poll(() => pixel(page, probe.x, probe.y)).not.toBe(THUMB)
    await page.mouse.move(probe.inside.x, probe.inside.y)
    await expect.poll(() => pixel(page, probe.x, probe.y)).toBe(THUMB)
    await page.mouse.move(900, 400)
    await expect.poll(() => pixel(page, probe.x, probe.y)).not.toBe(THUMB)
  })

})

test.describe('скрытые', () => {
  test('полосы нет и места не занимает, а колесо листает окно', async ({ page }) => {
    await open(page, 'hidden')
    expect(await page.evaluate(() => document.documentElement.clientWidth === window.innerWidth)).toBe(true)
    await scrollWindow(page)
  })

  test('у вложенного блока полосы тоже нет, но он прокручивается', async ({ page }) => {
    await open(page, 'hidden')
    await addScroller(page)
    const box = page.locator('#probe')
    expect(await box.evaluate((el) => el.clientWidth + 2 === el.offsetWidth)).toBe(true) // 2 px — рамка, полосы нет
    await page.mouse.move(200, 100)
    await page.mouse.wheel(0, 60)
    await expect.poll(() => box.evaluate((el) => el.scrollTop)).toBe(60)
  })
})
