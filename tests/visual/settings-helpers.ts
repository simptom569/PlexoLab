import { expect, type Locator, type Page } from '@playwright/test'

export const USER_BUTTON = /Лена М\.\s*Frontend/

/** Открывает окно «Настройки» из меню пользователя и возвращает его */
export async function openSettings(page: Page) {
  await page.getByRole('button', { name: USER_BUTTON }).click()
  await page.getByRole('menuitem', { name: 'Настройки' }).click()
  const dialog = page.getByRole('dialog', { name: 'Настройки' })
  await expect(dialog).toBeVisible()
  return dialog
}

/** Переходит на категорию по названию и ждёт её заголовок */
export async function pickTab(dialog: Locator, name: string) {
  await dialog.getByRole('tab', { name }).click()
  await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(name)
}
