import { useEffect } from 'react'
import { AppShell } from '../../components/AppShell'
import { Sidebar } from '../../components/Sidebar'
import { useUi } from '../../lib/ui-store'
import { DEMO_BACKLOG_COUNT, DEMO_PROJECTS, DEMO_USER } from './demo'
import { PagePlaceholder } from './PagePlaceholder'

export function Workspace() {
  const { page, project, theme, menu, setPage, setProject, toggleTheme, toggleMenu, closeMenus } = useUi()

  // Esc закрывает открытое меню
  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu, closeMenus])

  return (
    <AppShell
      dark={theme === 'dark'}
      menuOpen={menu !== null}
      onCloseMenus={closeMenus}
      sidebar={
        <Sidebar
          page={page}
          onPage={setPage}
          backlogCount={DEMO_BACKLOG_COUNT}
          projects={DEMO_PROJECTS}
          projectId={project}
          onProject={setProject}
          user={DEMO_USER}
          userMenuOpen={menu === 'user'}
          onToggleUserMenu={() => toggleMenu('user')}
          dark={theme === 'dark'}
          onToggleTheme={toggleTheme}
        />
      }
    >
      <PagePlaceholder page={page} />
    </AppShell>
  )
}
