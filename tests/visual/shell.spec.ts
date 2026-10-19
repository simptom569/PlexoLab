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
  await expect(menu.getByRole('menuitem')).toHaveText(['Тёмная тема', 'Выйти'])

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
