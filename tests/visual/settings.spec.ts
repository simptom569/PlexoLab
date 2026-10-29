import { expect, test } from '@playwright/test'
import { openApp, SERVER } from './fixtures'
import { openSettings, USER_BUTTON } from './settings-helpers'

// Окно «Настройки» (модалка с категориями слева) и шапка меню пользователя. В макете их нет, поэтому эталона
// из design/screenshots нет: снимки окна свои, в обеих темах. Обновить: npm run update

const TABS = ['Аккаунт', 'Внешний вид', 'Доска', 'Связь с сервером', 'Данные', 'Приложение', 'Горячие клавиши', 'О программе']
test.describe('меню пользователя', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await expect(page.locator('.side .count')).toHaveText('5')
  })

  test('в шапке e-mail, связь и адрес сервера, ниже «Настройки», «Поиск», «Уведомления», «Приглашения», «Архив проектов», тема и «Выйти»', async ({ page }) => {
    await page.getByRole('button', { name: USER_BUTTON }).click()
    const menu = page.getByRole('menu', { name: 'Меню пользователя' })
    await expect(menu.getByText('lena@example.com')).toBeVisible()
    await expect(menu.getByText('Связь есть')).toBeVisible()
    await expect(menu.getByText(SERVER)).toBeVisible()
    await expect(menu.getByRole('menuitem')).toHaveText(['Настройки', /^Поиск/, 'Уведомления', 'Приглашения', 'Архив проектов', 'Тёмная тема', 'Выйти'])
  })

  test('«Настройки» закрывают меню и открывают окно на «Аккаунте»', async ({ page }) => {
    const dialog = await openSettings(page)
    await expect(page.getByRole('menu', { name: 'Меню пользователя' })).toHaveCount(0)
    await expect(dialog.getByRole('tab', { name: 'Аккаунт' })).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Аккаунт')
  })

  test('категории: восемь вкладок, переключение мышью и стрелками, Home и End', async ({ page }) => {
    const dialog = await openSettings(page)
    const tabs = dialog.getByRole('tablist', { name: 'Категории настроек' }).getByRole('tab')
    await expect(tabs).toHaveText(TABS)

    await dialog.getByRole('tab', { name: 'Доска' }).click()
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Доска')

    await page.keyboard.press('ArrowDown')
    await expect(dialog.getByRole('tab', { name: 'Связь с сервером' })).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByRole('tab', { name: 'Связь с сервером' })).toBeFocused()
    await page.keyboard.press('End')
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('О программе')
    await page.keyboard.press('ArrowDown') // после последней категории снова первая
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Аккаунт')
    await page.keyboard.press('ArrowUp')
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('О программе')
    await page.keyboard.press('Home')
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Аккаунт')
  })

  test('Esc и крестик закрывают окно, фокус возвращается на карточку пользователя', async ({ page }) => {
    let dialog = await openSettings(page)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: USER_BUTTON })).toBeFocused()

    dialog = await openSettings(page)
    await dialog.getByRole('button', { name: 'Закрыть настройки' }).click()
    await expect(dialog).toHaveCount(0)
  })

  test('клик по затемнению закрывает окно', async ({ page }) => {
    const dialog = await openSettings(page)
    await page.mouse.click(8, 8)
    await expect(dialog).toHaveCount(0)
  })

  test('Tab не выходит из окна', async ({ page }) => {
    const dialog = await openSettings(page)
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab')
      expect(await dialog.evaluate((el) => el.contains(document.activeElement)), `Tab №${i + 1} ушёл из окна`).toBe(true)
    }
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Shift+Tab')
      expect(await dialog.evaluate((el) => el.contains(document.activeElement)), `Shift+Tab №${i + 1} ушёл из окна`).toBe(true)
    }
  })

  test('тумблер и сегменты меняют состояние, заглушки неактивны', async ({ page }) => {
    const dialog = await openSettings(page)

    await dialog.getByRole('tab', { name: 'Связь с сервером' }).click()
    const live = dialog.getByRole('switch', { name: 'Обновлять вживую' })
    await expect(live).toHaveAttribute('aria-checked', 'true')
    await live.click()
    await expect(live).toHaveAttribute('aria-checked', 'false')

    await dialog.getByRole('tab', { name: 'Внешний вид' }).click()
    const scrollbars = dialog.getByRole('group', { name: 'Полосы прокрутки' })
    await scrollbars.getByRole('button', { name: 'Тихие' }).click()
    await expect(scrollbars.getByRole('button', { name: 'Тихие' })).toHaveAttribute('aria-pressed', 'true')
    await expect(scrollbars.getByRole('button', { name: 'Видимые' })).toHaveAttribute('aria-pressed', 'false')

    await dialog.getByRole('tab', { name: 'Приложение' }).click()
    await expect(dialog.getByRole('switch')).toHaveCount(2)
    // запуск вместе с Windows есть только в приложении; «Сворачивать в трей» включено по умолчанию
    await expect(dialog.getByRole('switch', { name: 'Запускать вместе с Windows' })).toBeDisabled()
    await expect(dialog.getByRole('switch', { name: 'Сворачивать в трей при закрытии' })).toHaveAttribute('aria-checked', 'true')
    await expect(dialog.getByText('Скоро')).toHaveCount(0)
  })

  test('тема в окне переключает тему приложения', async ({ page }) => {
    const dialog = await openSettings(page)
    await dialog.getByRole('tab', { name: 'Внешний вид' }).click()
    await expect(page.locator('.app')).not.toHaveClass(/\bdark\b/)
    await dialog.getByRole('group', { name: 'Тема' }).getByRole('button', { name: 'Тёмная' }).click()
    await expect(page.locator('.app')).toHaveClass(/\bdark\b/)
    await dialog.getByRole('group', { name: 'Тема' }).getByRole('button', { name: 'Светлая' }).click()
    await expect(page.locator('.app')).not.toHaveClass(/\bdark\b/)
  })

  test('смена пароля раскрывается и сворачивается', async ({ page }) => {
    const dialog = await openSettings(page)
    await expect(dialog.getByLabel('Текущий')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Сменить пароль' }).click()
    await expect(dialog.getByLabel('Текущий')).toBeVisible()
    await expect(dialog.getByLabel('Новый')).toHaveAttribute('type', 'password')
    await dialog.getByRole('button', { name: 'Отмена' }).click()
    await expect(dialog.getByLabel('Текущий')).toHaveCount(0)
  })
})

for (const theme of ['light', 'dark'] as const) {
  test.describe(`снимки окна, тема: ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await openApp(page, { theme })
      await expect(page.locator('.side .count')).toHaveText('5')
    })

    TABS.forEach((tab, i) => {
      test(`категория «${tab}»`, async ({ page }) => {
        const dialog = await openSettings(page)
        await dialog.getByRole('tab', { name: tab }).click()
        await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(tab)
        await page.mouse.move(8, 8) // курсор на затемнение, чтобы ничего не было «под наведением»
        await expect(dialog).toHaveScreenshot(`settings-${i + 1}-${theme}.png`)
      })
    })

    test('меню пользователя с шапкой', async ({ page }) => {
      await page.getByRole('button', { name: USER_BUTTON }).click()
      const menu = page.getByRole('menu', { name: 'Меню пользователя' })
      await expect(menu.getByText('Связь есть')).toBeVisible()
      await page.mouse.move(800, 300)
      await expect(menu).toHaveScreenshot(`user-menu-${theme}.png`)
    })
  })
}
