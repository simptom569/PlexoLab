// Настройки приложения на этом компьютере (адрес сервера, тема, вид, фильтры): их нельзя отправлять на сервер.
// В окне Tauri это файл settings.json (tauri-plugin-store), в браузере при разработке и в тестах это localStorage.

import { isTauri } from './runtime'

/** Ключ в localStorage (браузерный режим); тесты кладут сюда настройки напрямую */
export const SETTINGS_KEY = 'plexolab.settings'
const STORE_FILE = 'settings.json'
const STORE_KEY = 'settings'

type TauriStore = { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void>; save(): Promise<void> }
let tauriStore: Promise<TauriStore> | null = null

function openTauriStore(): Promise<TauriStore> {
  tauriStore ??= import('@tauri-apps/plugin-store').then(({ load }) => load(STORE_FILE, { defaults: {}, autoSave: false }))
  return tauriStore
}

/** Читает сохранённые настройки как есть; разбор и значения по умолчанию в lib/settings.ts */
export async function readSettings(): Promise<unknown> {
  try {
    if (isTauri()) return await (await openTauriStore()).get(STORE_KEY)
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined // повреждённый файл не должен мешать запуску: будут значения по умолчанию
  }
}

export async function writeSettings(value: unknown): Promise<void> {
  try {
    if (isTauri()) {
      const store = await openTauriStore()
      await store.set(STORE_KEY, value)
      await store.save()
    } else {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(value))
    }
  } catch (e) {
    console.warn('Не удалось сохранить настройки', e)
  }
}
