// Внешние ссылки открываются в системном браузере, а не внутри окна приложения. В окне Tauri это делает плагин opener,
// в обычном браузере (разработка, тесты) — новая вкладка.

import { isTauri } from './runtime'

/** Открывает адрес http или https; остальное (javascript:, file:) игнорируется */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
    return
  }
  window.open(url, '_blank', 'noopener')
}
