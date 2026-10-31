// Обновления приложения: проверка и установка из GitHub Releases. Адрес файла `latest.json` и открытый ключ, которым
// проверяется подпись обновления, лежат в src-tauri/tauri.conf.json (plugins.updater). Есть только в окне Tauri:
// в обычном браузере (разработка, тесты) проверять нечего.

import { isTauri } from './runtime'

/** Событие загрузки обновления в том виде, в каком его отдаёт плагин */
export type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' }

export type FoundUpdate = {
  version: string
  /** Скачать и установить. Windows закрывает приложение на время установки, новая версия запускается сама. */
  install: (onEvent: (event: DownloadEvent) => void) => Promise<void>
}

/** Есть ли новая версия. В браузере всегда `null`. Ошибка (нет связи, в релизе нет файла обновления) уходит наверх. */
export async function checkForUpdate(): Promise<FoundUpdate | null> {
  if (!isTauri()) return null
  const { check } = await import('@tauri-apps/plugin-updater')
  const update = await check()
  if (!update) return null
  return { version: update.version, install: (onEvent) => update.downloadAndInstall(onEvent) }
}
