import { useEffect } from 'react'
import { useUi } from './ui-store'

/**
 * Ctrl+K (на Mac Cmd+K) открывает окно поиска, а когда оно уже открыто, закрывает. Клавиша узнаётся по коду, а не по букве,
 * поэтому работает и на русской раскладке. Действует, пока открыто рабочее пространство.
 */
export function useSearchShortcut(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.code !== 'KeyK') return
      e.preventDefault()
      const ui = useUi.getState()
      if (ui.projectDialog?.kind === 'search') ui.closeProjectDialog()
      else ui.openProjectDialog({ kind: 'search' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
