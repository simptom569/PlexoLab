import { expect, test } from '@playwright/test'
import { openApp } from './fixtures'

// Поведение каркаса: навигация, проекты, меню пользователя, тема, Esc, выход

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('навигация переключает экран и aria-current', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: 'Основная навигация' })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Доска')

  await nav.getByRole('button', { name: 'Релизы и вехи' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Релизы и вехи')
  await expect(nav.getByRole('button', { name: 'Релизы и вехи' })).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('button', { name: 'Доска' })).toHaveAttribute('aria-current', 'false')
  await expect(nav.getByRole('button', { name: 'Релизы и вехи' })).toHaveClass(/\bon\b/)
})

test('выбор проекта подсвечивает его классом cur', async ({ page }) => {
  const projects = page.getByRole('navigation', { name: 'Проекты' })
  await projects.getByRole('button', { name: 'Мобильный API' }).click()
  await expect(projects.getByRole('button', { name: 'Мобильный API' })).toHaveClass(/\bcur\b/)
  await expect(projects.getByRole('button', { name: 'Web-приложение' })).not.toHaveClass(/\bcur\b/)
})

test('счётчик бэклога относится к выбранному проекту', async ({ page }) => {
  const count = page.locator('.side .count')
  await expect(count).toHaveText('5')
  await page.getByRole('navigation', { name: 'Проекты' }).getByRole('button', { name: 'Мобильный API' }).click()
  await expect(count).toHaveText('1')
  await page.getByRole('navigation', { name: 'Проекты' }).getByRole('button', { name: 'Инфраструктура' }).click()
  await expect(count).toHaveText('1')
})

test('меню пользователя: открывается, закрывается по Esc и по клику мимо', async ({ page }) => {
  const trigger = page.getByRole('button', { name: /Лена М\./ })
  const menu = page.getByRole('menu', { name: 'Меню пользователя' })

  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem')).toHaveText(['Настройки', /^Поиск/, 'Уведомления', 'Приглашения', 'Архив проектов', 'Тёмная тема', 'Выйти'])

  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()

  await trigger.click()
  await expect(menu).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть меню' }).click({ position: { x: 700, y: 400 } })
  await expect(menu).toBeHidden()
})

test('переключатель темы ставит класс dark на .app, меняет подпись и запоминается', async ({ page }) => {
  const app = page.locator('.app')
  await expect(app).not.toHaveClass(/\bdark\b/)

  await page.getByRole('button', { name: /Лена М\./ }).click()
  await page.getByRole('menuitem', { name: 'Тёмная тема' }).click()
  await expect(app).toHaveClass(/\bdark\b/)

  await page.getByRole('button', { name: /Лена М\./ }).click()
  await expect(page.getByRole('menuitem', { name: /тема/ }).first()).toHaveText('Светлая тема')

  // после перезагрузки тема сохраняется (локальные настройки), вход тоже
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500) // настройки пишутся с небольшой задержкой
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
  await expect(page.locator('.app')).toHaveClass(/\bdark\b/)
})

test('открытая страница и проект запоминаются между запусками', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Вики' }).click()
  await page.getByRole('navigation', { name: 'Проекты' }).getByRole('button', { name: 'Мобильный API' }).click()
  await page.waitForTimeout(500)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Вики')
  await expect(page.getByRole('navigation', { name: 'Проекты' }).getByRole('button', { name: 'Мобильный API' })).toHaveClass(/\bcur\b/)
})

test('«Выйти» возвращает на экран входа', async ({ page }) => {
  await page.getByRole('button', { name: /Лена М\./ }).click()
  await page.getByRole('menuitem', { name: 'Выйти' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Вход')
  await expect(page.getByLabel('E-mail')).toHaveValue('lena@example.com')
})

// Боковое меню закреплено на высоту окна (app/src/styles/shell.css): карточка пользователя всегда под рукой

const side = (page: import('@playwright/test').Page) => page.locator('.app > .side')
// на экране «Активность» есть и чип «Лена М.», поэтому кнопку меню ищем по роли внутри бокового меню
const userButton = (page: import('@playwright/test').Page) => side(page).getByRole('button', { name: /Лена М\.\s*Frontend/ })
const sideBox = async (page: import('@playwright/test').Page) => (await side(page).boundingBox())!

async function openActivityAt(page: import('@playwright/test').Page, width: number, height: number) {
  await page.setViewportSize({ width, height })
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Активность' }).click()
  await expect(page.getByRole('heading', { name: 'Активность', level: 1 })).toBeVisible()
  await expect(page.locator('.act-row').first()).toBeVisible()
}

test.describe('боковое меню закреплено на высоту окна', () => {
  test('страница длиннее окна: меню остаётся на месте, карточка пользователя на виду', async ({ page }) => {
    await openActivityAt(page, 1440, 700)
    expect(await page.evaluate(() => document.documentElement.scrollHeight), 'страница длиннее окна').toBeGreaterThan(700)

    const trigger = userButton(page)
    await expect(trigger).toBeInViewport({ ratio: 1 })

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    expect(await page.evaluate(() => window.scrollY), 'страница прокрутилась').toBeGreaterThan(100)

    const box = await sideBox(page)
    expect(box.y).toBe(0)
    expect(box.height).toBe(700)
    await expect(trigger).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeInViewport({ ratio: 1 })
  })

  test('после прокрутки меню пользователя открывается целиком и пункты нажимаются', async ({ page }) => {
    await openActivityAt(page, 1440, 700)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))

    await userButton(page).click()
    const menu = page.getByRole('menu', { name: 'Меню пользователя' })
    await expect(menu).toBeVisible()
    const menuBox = (await menu.boundingBox())!
    const box = await sideBox(page)
    expect(menuBox.x).toBeGreaterThanOrEqual(box.x)
    expect(menuBox.x + menuBox.width, 'меню не обрезается краем бокового меню').toBeLessThanOrEqual(box.x + box.width)

    await menu.getByRole('menuitem', { name: 'Тёмная тема' }).click()
    await expect(page.locator('.app')).toHaveClass(/\bdark\b/)
  })

  test('на высоте окна на доске меню не изменилось: карточка пользователя прижата к низу окна', async ({ page }) => {
    const box = await sideBox(page)
    expect(box.height).toBe(900)
    const trigger = (await userButton(page).boundingBox())!
    expect(trigger.y + trigger.height).toBeGreaterThan(900 - 30)
    expect(trigger.y + trigger.height).toBeLessThanOrEqual(900)
  })

  test('окно ниже самого меню: меню прокручивается само, до карточки пользователя можно добраться', async ({ page }) => {
    await openActivityAt(page, 1440, 480)
    const scrollable = await side(page).evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight, overflowY: getComputedStyle(el).overflowY }))
    expect(scrollable.overflowY).toBe('auto')
    expect(scrollable.scroll).toBeGreaterThan(scrollable.client)

    const trigger = userButton(page)
    await trigger.scrollIntoViewIfNeeded()
    await expect(trigger).toBeInViewport({ ratio: 1 })
    await trigger.click()
    await expect(page.getByRole('menu', { name: 'Меню пользователя' })).toBeVisible()
  })

  test('в узком окне меню не закрепляется: оно над содержимым, как в макете', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 900 })
    const style = await side(page).evaluate((el) => {
      const s = getComputedStyle(el)
      return { position: s.position, overflowY: s.overflowY, height: el.getBoundingClientRect().height }
    })
    expect(style.position).toBe('static')
    expect(style.overflowY).toBe('visible')
    expect(style.height, 'не растянуто на всё окно').toBeLessThan(900)
  })

  test('затемнение и панель задачи по-прежнему перекрывают меню', async ({ page }) => {
    await page.locator('[data-card-id]', { hasText: 'WEB-144' }).getByRole('button', { name: 'Вход через SSO для корпоративных аккаунтов' }).click()
    await expect(page.getByRole('dialog', { name: /^Задача / })).toBeVisible()
    const point = await page.evaluate(() => {
      const el = document.elementFromPoint(100, 300)
      return el ? { cls: el.className, tag: el.tagName } : null
    })
    expect(point?.cls, 'в точке над боковым меню сверху затемнение, а не меню').toContain('scrim')
  })
})
