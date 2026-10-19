/** Запущено внутри окна Tauri (а не в обычном браузере при разработке и в тестах) */
export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
