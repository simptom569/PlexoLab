import type { ReactNode } from 'react'
import { ThemeRoot } from '../../components/AppShell'
import { useSession } from '../../lib/session'
import { useDark } from '../../lib/useDark'
import { LoginStep } from './LoginStep'
import { OfflineStep } from './OfflineStep'
import { ServerStep } from './ServerStep'

/** Показывает шаг входа или, когда человек вошёл, само приложение */
export function AuthGate({ children }: { children: ReactNode }) {
  const phase = useSession((s) => s.phase)
  const dark = useDark()

  switch (phase) {
    case 'server':
      return <ServerStep />
    case 'login':
      return <LoginStep />
    case 'offline':
      return <OfflineStep />
    case 'ready':
      return <>{children}</>
    default:
      // идёт запуск: пустой экран в цвете темы, чтобы не мигало белым
      return <ThemeRoot dark={dark}>{null}</ThemeRoot>
  }
}
