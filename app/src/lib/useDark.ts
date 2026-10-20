import { useSyncExternalStore } from 'react'
import { resolveDark, subscribeSystemDark, systemDark } from './theme'
import { useUi } from './ui-store'

/** Тёмная ли тема сейчас: выбранная в настройках или, при «как в системе», настройка Windows (меняется на лету) */
export function useDark(): boolean {
  const theme = useUi((s) => s.theme)
  const system = useSyncExternalStore(subscribeSystemDark, systemDark, () => false)
  return resolveDark(theme, system)
}
