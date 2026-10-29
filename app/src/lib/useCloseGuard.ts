import { useEffect } from 'react'
import { guardUnload, handleTrayQuit, handleWindowClose } from './closeGuard'
import { hideWindow, onTrayQuit, quitApp, showWindow } from './platform/desktop'
import { isTauri } from './platform/runtime'
import { useUi } from './ui-store'

/**
 * Что делает приложение, когда его просят закрыть (lib/closeGuard.ts).
 * В окне Tauri крестик прячет окно в трей (если включено «Сворачивать в трей при закрытии») или закрывает с проверкой
 * неотправленного текста; «Выйти» в меню трея проверяет текст так же. В браузере `beforeunload` не даёт закрыть
 * вкладку с неотправленным текстом.
 */
export function useCloseGuard(): void {
  useEffect(() => {
    if (!isTauri()) {
      const onUnload = (e: BeforeUnloadEvent) => guardUnload(e)
      window.addEventListener('beforeunload', onUnload)
      return () => window.removeEventListener('beforeunload', onUnload)
    }

    let cancelled = false
    const stops: Array<() => void> = []
    const keep = (stop: () => void) => (cancelled ? stop() : stops.push(stop))
    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      keep(
        await win.onCloseRequested(async (event) => {
          // решаем сами: закрывать, прятать или остаться
          event.preventDefault()
          const action = await handleWindowClose(useUi.getState().closeToTray)
          if (action === 'hide') await hideWindow()
          else if (action === 'close') await win.destroy()
        }),
      )
      keep(
        await onTrayQuit(() => {
          void handleTrayQuit(showWindow).then((action) => (action === 'close' ? quitApp() : undefined))
        }),
      )
    })()
    return () => {
      cancelled = true
      stops.forEach((stop) => stop())
    }
  }, [])
}
