import { QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { AuthGate } from './features/auth/AuthGate'
import { Workspace } from './features/workspace/Workspace'
import { queryClient } from './lib/query'
import { useCloseGuard } from './lib/useCloseGuard'
import { useScrollbars } from './lib/useScrollbars'

// Витрина компонентов нужна только при разработке и в сборку не попадает
const Showcase = import.meta.env.DEV ? lazy(() => import('./features/showcase/Showcase')) : null

export default function App() {
  useScrollbars()
  // крестик и «Выйти» в трее: прячут окно или закрывают, не теряя неотправленный текст (lib/closeGuard.ts); работает и на экране входа
  useCloseGuard()
  if (Showcase && location.pathname === '/showcase') {
    return (
      <Suspense fallback={null}>
        <Showcase />
      </Suspense>
    )
  }
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <Workspace />
      </AuthGate>
    </QueryClientProvider>
  )
}
