// Refresh-токен. В окне Tauri он лежит в хранилище учётных данных Windows (команды token_* в Rust), а не в файле.
// В браузере при разработке и в тестах хранилища нет, там localStorage: только для разработки.

import { isTauri } from './runtime'

/** Префикс ключа в localStorage (браузерный режим); тесты кладут токен напрямую */
export const SECRET_KEY_PREFIX = 'plexolab.refresh@'

async function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

export async function getRefreshToken(server: string): Promise<string | null> {
  try {
    if (isTauri()) return (await invoke<string | null>('token_get', { server })) ?? null
    return window.localStorage.getItem(SECRET_KEY_PREFIX + server)
  } catch (e) {
    console.warn('Не удалось прочитать сохранённый вход', e)
    return null
  }
}

export async function setRefreshToken(server: string, token: string): Promise<void> {
  if (isTauri()) await invoke('token_set', { server, token })
  else window.localStorage.setItem(SECRET_KEY_PREFIX + server, token)
}

export async function deleteRefreshToken(server: string): Promise<void> {
  try {
    if (isTauri()) await invoke('token_delete', { server })
    else window.localStorage.removeItem(SECRET_KEY_PREFIX + server)
  } catch (e) {
    console.warn('Не удалось удалить сохранённый вход', e)
  }
}
