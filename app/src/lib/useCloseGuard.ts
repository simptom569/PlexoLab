import { useEffect } from 'react'
import { guardUnload, handleCloseRequest } from './closeGuard'
import { isTauri } from './platform/runtime'
import { unsentCount } from './unsent'

/**
 * Пока открыто рабочее пространство, закрыть окно с неотправленным текстом нельзя молча (lib/closeGuard.ts).
 * В окне Tauri это просьба закрыть окно (`onCloseRequested`), в браузере `beforeunload`.
 */
export function useCloseGuard(): void {
  useEffect(() => {
    if (!isTauri()) {
      const onUnload = (e: BeforeUnloadEvent) => guardUnload(e)
      window.addEventListener('beforeunload', onUnload)
      return () => window.removeEventListener('beforeunload', onUnload)
    }

    let cancelled = false
    let stop: (() => void) | undefined
    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      const unlisten = await win.onCloseRequested(async (event) => {
        // нечего терять: окно закрывается само, как без защиты
        if (unsentCount() === 0) return
        event.preventDefault()
        if ((await handleCloseRequest()) === 'close') await win.destroy()
      })
      if (cancelled) unlisten()
      else stop = unlisten
    })()
    return () => {
      cancelled = true
      stop?.()
    }
  }, [])
}
