import type { Theme } from './settings'

const QUERY = '(prefers-color-scheme: dark)'

/** Включена ли тёмная тема в системе. Без браузера (в тестах) считается, что нет. */
export const systemDark = (): boolean => typeof matchMedia === 'function' && matchMedia(QUERY).matches

/** Тёмная ли тема на самом деле: «как в системе» берёт настройку Windows */
export const resolveDark = (theme: Theme, system: boolean = systemDark()): boolean => theme === 'dark' || (theme === 'system' && system)

/** Подписка на смену настройки системы, в форме для useSyncExternalStore */
export function subscribeSystemDark(onChange: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => {}
  const query = matchMedia(QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
