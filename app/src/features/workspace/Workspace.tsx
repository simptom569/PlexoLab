import { useEffect, useMemo } from 'react'
import { AppShell } from '../../components/AppShell'
import { Sidebar, type SidebarProject } from '../../components/Sidebar'
import { useBoard, useProjects } from '../../lib/api/queries'
import { useSession } from '../../lib/session'
import { useUi } from '../../lib/ui-store'
import { BoardPage } from '../board/BoardPage'
import { TaskDrawer } from '../board/TaskDrawer'
import { PagePlaceholder } from './PagePlaceholder'

export function Workspace() {
  const user = useSession((s) => s.user)
  const logout = useSession((s) => s.logout)
  const { page, project, theme, menu, setPage, setProject, toggleTheme, toggleMenu, closeMenus } = useUi()
  const projects = useProjects()

  // Открытый проект: сохранённый, если он ещё существует, иначе первый
  const list = projects.data
  const projectId = list?.find((p) => p.id === project)?.id ?? list?.[0]?.id ?? null
  useEffect(() => {
    if (projectId && projectId !== project) setProject(projectId)
  }, [projectId, project, setProject])

  const board = useBoard(projectId)
  const backlogCount = board.data?.tasks.filter((t) => t.column_id === null || t.column_id === undefined).length ?? 0

  const sidebarProjects: SidebarProject[] = useMemo(
    () => (list ?? []).map((p) => ({ id: p.id, name: p.name, color: `var(--${p.color})` })),
    [list],
  )

  // Esc закрывает открытое меню
  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu, closeMenus])

  if (!user) return null

  return (
    <AppShell
      dark={theme === 'dark'}
      menuOpen={menu !== null}
      onCloseMenus={closeMenus}
      overlay={projectId ? <TaskDrawer projectId={projectId} /> : null}
      sidebar={
        <Sidebar
          page={page}
          onPage={setPage}
          backlogCount={backlogCount}
          projects={sidebarProjects}
          projectId={projectId ?? ''}
          onProject={setProject}
          user={{ name: user.name, role: user.role, tone: user.tone }}
          userMenuOpen={menu === 'user'}
          onToggleUserMenu={() => toggleMenu('user')}
          dark={theme === 'dark'}
          onToggleTheme={toggleTheme}
          onLogout={() => {
            closeMenus() // иначе после следующего входа меню осталось бы открытым
            void logout()
          }}
        />
      }
    >
      {page === 'board' && projectId ? <BoardPage key={projectId} projectId={projectId} /> : <PagePlaceholder page={page} />}
    </AppShell>
  )
}
