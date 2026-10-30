import { expect, type Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { E2E_OUTBOX_DIR } from './scripts/e2e-env.mjs'
import { fixToday, SERVER } from './fixtures'
import { settle } from './helpers'

/** Письмо, которое тестовый сервер записал в папку вместо отправки (MAIL_OUTBOX_DIR) */
export type OutboxMail = { to: string; subject: string; text: string; html: string }

export const address = SERVER.replace('http://', '')

/** Все письма из папки, старые первыми. Папка создаётся сервером при первом письме и стирается вместе с данными. */
export function readOutbox(): OutboxMail[] {
  if (!existsSync(E2E_OUTBOX_DIR)) return []
  return readdirSync(E2E_OUTBOX_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(path.join(E2E_OUTBOX_DIR, name), 'utf8')) as OutboxMail)
}

/** Код из письма: первые шесть цифр подряд в тексте (код стоит в тексте раньше адреса, где цифры тоже бывают) */
export function codeOf(mail: OutboxMail): string {
  const m = /(?<!\d)\d{6}(?!\d)/.exec(mail.text)
  if (!m) throw new Error(`в письме нет кода: ${mail.text}`)
  return m[0]
}

/** Ждёт, пока в папке станет не меньше `count` писем этому адресу, и возвращает последнее */
export async function waitForMail(to: string, count = 1): Promise<OutboxMail> {
  let mails: OutboxMail[] = []
  await expect
    .poll(() => (mails = readOutbox().filter((m) => m.to === to)).length, { message: `письмо для ${to}`, timeout: 10_000 })
    .toBeGreaterThanOrEqual(count)
  return mails[mails.length - 1]
}

/** Экран входа на тестовом сервере: адрес уже введён, входа нет. Тему можно выбрать заранее. */
export async function openLogin(page: Page, theme: 'light' | 'dark' = 'light') {
  await fixToday(page)
  await page.addInitScript(
    ({ server, saved }) => {
      // только при первой загрузке: после перезагрузки страницы клиент уже сохранил своё
      if (!window.localStorage.getItem('plexolab.settings')) window.localStorage.setItem('plexolab.settings', JSON.stringify({ serverUrl: server, ...saved }))
    },
    { server: SERVER, saved: { theme } },
  )
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Вход')
  await settle(page)
}
