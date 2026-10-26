// Общее для проверок «нет связи»: обрыв средствами браузера и полоска. Запросы самого теста к серверу (`page.request`,
// то есть `api()`) идут как обычно, так что «другой человек» может править, пока у первого связи нет.

import { expect, type Page } from '@playwright/test'

export const bar = (page: Page) => page.getByRole('status').filter({ hasText: 'Нет связи с сервером' })
export const card = (page: Page, key: string) => page.locator('[data-card-id]', { hasText: key })

/** Связь пропала; полоска появится через три секунды */
export async function cutOff(page: Page) {
  await page.context().setOffline(true)
}

/** Связь пропала и «просмотр» включился */
export async function cutOffAndWait(page: Page) {
  await cutOff(page)
  await expect(bar(page)).toBeVisible({ timeout: 8000 })
}

export async function restore(page: Page) {
  await page.context().setOffline(false)
}

/** Просит клиент перечитать все данные (как это делает сам клиент, когда приходит чужое изменение) */
export async function refetchAll(page: Page) {
  await page.evaluate(async () => {
    const path = '/src/lib/query.ts'
    const { queryClient } = await import(/* @vite-ignore */ path)
    await queryClient.invalidateQueries()
  })
}

/** Пункт основной навигации по началу названия */
export const nav = (page: Page, name: RegExp | string) => page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name })
