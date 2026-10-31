// Состояние обновления приложения: проверка (по просьбе и в фоне) и установка. Найденное обновление держим вне состояния:
// это объект плагина, показывать его не нужно, а в состоянии лежит только то, что видит человек.

import { create } from 'zustand'
import { handleCloseRequest } from '../../lib/closeGuard'
import { checkForUpdate, type FoundUpdate } from '../../lib/platform/updater'
import { applyDownloadEvent, percentOf, START_PROGRESS, type UpdatePhase } from './logic'

type UpdatesState = {
  phase: UpdatePhase
  /** Проверить. `silent`: фоновая проверка, пока ничего не найдено, не меняет то, что видит человек, и молчит об ошибках */
  check: (options?: { silent?: boolean }) => Promise<void>
  /** Скачать и установить найденную версию. Приложение закроется само и откроется новым. */
  install: () => Promise<void>
}

let found: FoundUpdate | null = null

export const useUpdates = create<UpdatesState>()((set, get) => ({
  phase: { kind: 'idle' },

  check: async ({ silent = false } = {}) => {
    const kind = get().phase.kind
    if (kind === 'checking' || kind === 'downloading') return
    if (!silent) set({ phase: { kind: 'checking' } })
    try {
      const update = await checkForUpdate()
      found = update
      if (update) set({ phase: { kind: 'available', version: update.version } })
      else if (!silent) set({ phase: { kind: 'upToDate' } })
      else if (get().phase.kind === 'available') set({ phase: { kind: 'idle' } })
    } catch {
      if (!silent) set({ phase: { kind: 'error', during: 'check' } })
    }
  },

  install: async () => {
    const update = found
    const { phase } = get()
    const canInstall = phase.kind === 'available' || (phase.kind === 'error' && phase.during === 'install')
    if (!update || !canInstall) return
    // установка закрывает приложение: неотправленный текст сначала уходит на сервер, а если не вышло, решает человек
    if ((await handleCloseRequest()) === 'stay') return
    let progress = START_PROGRESS
    set({ phase: { kind: 'downloading', version: update.version, percent: null } })
    try {
      await update.install((event) => {
        progress = applyDownloadEvent(progress, event)
        set({ phase: { kind: 'downloading', version: update.version, percent: percentOf(progress) } })
      })
    } catch {
      set({ phase: { kind: 'error', during: 'install', version: update.version } })
    }
  },
}))
