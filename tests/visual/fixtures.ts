import { expect, type Page } from '@playwright/test'
import { E2E_SERVER_URL, MOCK_TODAY, seedDatabase } from './scripts/e2e-env.mjs'
import { settle } from './helpers'

export const SERVER = E2E_SERVER_URL

/** Общая команда демо-данных: сид называет её как подпись под названием приложения в макете */
export const DEMO_TEAM = 'Рабочее пространство'

// Ключи localStorage, в которые клиент складывает настройки и токен в браузерном режиме
// (см. app/src/lib/platform/storage.ts и secrets.ts)
const SETTINGS_KEY = 'plexolab.settings'
const REFRESH_PREFIX = 'plexolab.refresh@'

export type OpenOptions = {
  email?: string
  password?: string
  theme?: 'light' | 'dark' | 'system'
  /** Что добавить к сохранённым настройкам (вид, фильтры и т. п.) */
  settings?: Record<string, unknown>
  /** Страница приложения, по умолчанию корень */
  url?: string
}

/**
 * «Сегодня» как в макете: 18 октября 2026 (воскресенье), полдень по UTC. Тот же момент сид считает «сейчас»
 * (`seed --today`), а браузер работает в часовом поясе UTC (playwright.config.ts): лента получается одной и той же,
 * на какой бы машине и в какой бы день ни шли тесты.
 */
export async function fixToday(page: Page) {
  await page.clock.setFixedTime(new Date(`${MOCK_TODAY}T12:00:00Z`))
}

/** Стирает данные тестовой базы и заполняет их данными макета заново */
export function resetData() {
  seedDatabase()
}

/**
 * Открывает приложение уже вошедшим (как будто человек входил раньше): токен получается напрямую у сервера
 * и кладётся туда, где его ждёт клиент. Само приложение при запуске обменивает его на рабочий.
 */
export async function openApp(page: Page, options: OpenOptions = {}) {
  const { email = 'lena@example.com', password = 'dev', theme = 'light', settings = {}, url = '/' } = options
  await fixToday(page)

  const res = await page.request.post(`${SERVER}/api/v1/auth/login`, { data: { email, password } })
  expect(res.ok(), `вход ${email} не удался: ${res.status()}`).toBeTruthy()
  const { refresh_token, access_token } = (await res.json()) as { refresh_token: string; access_token: string }
  // человек выбирает команду сам; тесты по умолчанию начинают в общей команде демо-данных, где лежат проекты макета
  let team: string | null = null
  if (!('team' in settings)) {
    const teams = await page.request.get(`${SERVER}/api/v1/teams`, { headers: { Authorization: `Bearer ${access_token}` } })
    team = ((await teams.json()) as Array<{ id: string; name: string }>).find((x) => x.name === DEMO_TEAM)?.id ?? null
  }

  await page.addInitScript(
    ({ server, refresh, settingsKey, refreshPrefix, saved }) => {
      // только при первой загрузке: после перезагрузки страницы клиент уже положил свежий токен
      if (!window.localStorage.getItem(settingsKey)) {
        window.localStorage.setItem(settingsKey, JSON.stringify(saved))
        window.localStorage.setItem(refreshPrefix + server, refresh)
      }
    },
    {
      server: SERVER,
      refresh: refresh_token,
      settingsKey: SETTINGS_KEY,
      refreshPrefix: REFRESH_PREFIX,
      saved: { serverUrl: SERVER, lastEmail: email, theme, ...(team ? { team } : {}), ...settings },
    },
  )
  await page.goto(url)
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
  await settle(page)
}

/** Открывает приложение «с нуля»: ни адреса сервера, ни входа */
export async function openFresh(page: Page) {
  await fixToday(page)
  await page.goto('/')
  await settle(page)
}
