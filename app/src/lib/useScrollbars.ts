import { useEffect } from 'react'
import { applyScrollbars } from './scrollbars'
import { useUi } from './ui-store'

/** Применяет выбранный в настройках режим полос прокрутки ко всему окну */
export function useScrollbars(): void {
  const mode = useUi((s) => s.scrollbars)
  useEffect(() => applyScrollbars(mode), [mode])
}
