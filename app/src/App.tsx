import { lazy, Suspense } from 'react'
import { Workspace } from './features/workspace/Workspace'

// Витрина компонентов нужна только при разработке и в сборку не попадает
const Showcase = import.meta.env.DEV ? lazy(() => import('./features/showcase/Showcase')) : null

export default function App() {
  if (Showcase && location.pathname === '/showcase') {
    return (
      <Suspense fallback={null}>
        <Showcase />
      </Suspense>
    )
  }
  return <Workspace />
}
