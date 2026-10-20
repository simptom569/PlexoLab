import { useEffect, useMemo, type ReactNode } from 'react'
import { AppShell } from '../../components/AppShell'
import { Sidebar, type SidebarProject } from '../../components/Sidebar'
import { Toast } from '../../components/Toast'
import { useBoard, useProjects } from '../../lib/api/queries'
import { queryClient } from '../../lib/query'
import { useRealtime } from '../../lib/realtime/useRealtime'
import type { PageId } from '../../lib/pages'
import { useSession } from '../../lib/session'
import { useUi } from '../../lib/ui-store'
import { ActivityPage } from '../activity/ActivityPage'
import { BacklogPage } from '../backlog/BacklogPage'
import { BoardPage } from '../board/BoardPage'
import { TaskDrawer } from '../board/TaskDrawer'
import { DocsScreen } from '../docs/DocsScreen'
import { LinksPage } from '../links/LinksPage'
import { ModulesPage } from '../modules/ModulesPage'
import { ReleasesPage } from '../releases/ReleasesPage'
import { WikiScreen } from '../wiki/WikiScreen'

/** Экраны проекта: показываются для выбранного проекта */
const PROJECT_PAGES: Partial<Record<PageId, (props: { projectId: string }) => ReactNode>> = {
  board: BoardPage,
  backlog: BacklogPage,
  modules: ModulesPage,
  releases: ReleasesPage,
}

/** Экраны всей команды: от выбранного проекта не зависят */
const TEAM_PAGES: Partial<Record<PageId, () => ReactNode>> = {
  wiki: WikiScreen,
  docs: DocsScreen,
  activity: ActivityPage,
  links: LinksPage,
}

export function Workspace() {
  const user = useSession((s) => s.user)
  const logout = useSession((s) => s.logout)
  const { page, project, theme, menu, setPage, setProject, toggleTheme, toggleMenu, closeMenus } = useUi()
  const projects = useProjects()
  // пока человек в приложении, держим связь с сервером: чужие изменения приходят сразу, а не при следующем открытии экрана
  const connection = useRealtime(queryClient)

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

  const ProjectPage = PROJECT_PAGES[page]
  const TeamPage = TEAM_PAGES[page]

  return (
    <AppShell
      dark={theme === 'dark'}
      menuOpen={menu !== null}
      onCloseMenus={closeMenus}
      overlay={
        <>
          {projectId ? <TaskDrawer projectId={projectId} /> : null}
          <Toast />
        </>
      }
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
          connection={connection}
          onLogout={() => {
            closeMenus() // иначе после следующего входа меню осталось бы открытым
            void logout()
          }}
        />
      }
    >
      {TeamPage ? (
        <TeamPage />
      ) : ProjectPage && projectId ? (
        <ProjectPage key={`${page}:${projectId}`} projectId={projectId} />
      ) : null}
    </AppShell>
  )
}
