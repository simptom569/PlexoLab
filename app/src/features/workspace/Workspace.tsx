import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { AppShell } from '../../components/AppShell'
import { Sidebar, type SidebarProject } from '../../components/Sidebar'
import { OfflineBar } from '../../components/OfflineBar'
import { Toast } from '../../components/Toast'
import { Button } from '../../components/Button'
import { EmptyState } from '../../components/Surfaces'
import { useBoard, useMyInvites, useNotifications, useProjects, useUsers } from '../../lib/api/queries'
import { queryClient } from '../../lib/query'
import { useRealtime } from '../../lib/realtime/useRealtime'
import type { PageId } from '../../lib/pages'
import { useSession } from '../../lib/session'
import { useUi } from '../../lib/ui-store'
import { useDark } from '../../lib/useDark'
import { useCloseGuard } from '../../lib/useCloseGuard'
import { useLinkWatch } from '../../lib/useLinkWatch'
import { SettingsModal } from '../settings/SettingsModal'
import { CloseAskDialog } from './CloseAskDialog'
import { ActivityPage } from '../activity/ActivityPage'
import { BacklogPage } from '../backlog/BacklogPage'
import { BoardPage } from '../board/BoardPage'
import { TaskDrawer } from '../board/TaskDrawer'
import { DocsScreen } from '../docs/DocsScreen'
import { LinksPage } from '../links/LinksPage'
import { ProjectDialogs } from '../projects/ProjectDialogs'
import { ModulesPage } from '../modules/ModulesPage'
import { ReleasesPage } from '../releases/ReleasesPage'
import { WikiScreen } from '../wiki/WikiScreen'

/** Экраны проекта: показываются для выбранного проекта */
const PROJECT_PAGES: Partial<Record<PageId, (props: { projectId: string }) => ReactNode>> = {
  board: BoardPage,
  backlog: BacklogPage,
  modules: ModulesPage,
  releases: ReleasesPage,
  docs: DocsScreen,
  activity: ActivityPage,
  links: LinksPage,
}

/** Экраны всей команды: от выбранного проекта не зависят (вики общая) */
const TEAM_PAGES: Partial<Record<PageId, () => ReactNode>> = {
  wiki: WikiScreen,
}

export function Workspace() {
  const user = useSession((s) => s.user)
  const logout = useSession((s) => s.logout)
  const serverUrl = useSession((s) => s.serverUrl)
  const {
    page,
    project,
    menu,
    settingsTab,
    live,
    setPage,
    setProject,
    toggleTheme,
    toggleMenu,
    closeMenus,
    openSettings,
    openProjectDialog,
    openProjectMenu,
  } = useUi()
  const dark = useDark()
  const projects = useProjects()
  const invites = useMyInvites()
  const notifications = useNotifications()
  // пока человек в приложении, держим связь с сервером: чужие изменения приходят сразу, а не при следующем открытии экрана
  const connection = useRealtime(queryClient, live)
  // сеть пропала или вернулась: узнаём сразу, а не по неудачному запросу
  useLinkWatch()
  // окно с неотправленным текстом молча не закрывается (lib/closeGuard.ts)
  useCloseGuard()
  // карточка пользователя, из меню которой открыли настройки: туда вернётся фокус
  const settingsOpener = useRef<HTMLElement | null>(null)

  // Свой профиль могли поменять на другом устройстве: когда список участников пришёл заново, подтягиваем его в сессию
  // (боковое меню, «мои задачи» и комментарии берут «себя» оттуда). Следим только за списком, а не за сессией: сразу
  // после своей правки в сессии уже новое, а список ещё старый, и сверка по сессии вернула бы старое имя на миг.
  const users = useUsers()
  useEffect(() => {
    const me = useSession.getState().user
    const mine = users.data?.find((u) => u.id === me?.id)
    if (me && mine && (mine.name !== me.name || mine.role !== me.role || mine.tone !== me.tone)) useSession.setState({ user: mine })
  }, [users.data])

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

  // Окно настроек не должно пережить рабочее пространство: после выхода или потери входа оно не откроется само при следующем входе
  useEffect(
    () => () => {
      useUi.getState().closeSettings()
      useUi.getState().closeProjectDialog()
      useUi.getState().closeProjectMenu()
    },
    [],
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
      dark={dark}
      menuOpen={menu !== null}
      onCloseMenus={closeMenus}
      notice={<OfflineBar />}
      overlay={
        <>
          {projectId ? <TaskDrawer projectId={projectId} /> : null}
          {settingsTab ? <SettingsModal tab={settingsTab} connection={connection} returnFocus={settingsOpener} /> : null}
          <ProjectDialogs />
          <CloseAskDialog />
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
          user={{ name: user.name, role: user.role, tone: user.tone, email: user.email }}
          userMenuOpen={menu === 'user'}
          onToggleUserMenu={() => toggleMenu('user')}
          dark={dark}
          onToggleTheme={toggleTheme}
          onOpenSettings={(trigger) => {
            settingsOpener.current = trigger
            openSettings()
          }}
          serverUrl={serverUrl}
          onNewProject={() => openProjectDialog({ kind: 'new' })}
          onProjectMenu={(id, x, y) => openProjectMenu({ id, x, y })}
          invitesCount={invites.data?.length ?? 0}
          onOpenInvites={() => openProjectDialog({ kind: 'invites' })}
          notificationsCount={notifications.data?.unread ?? 0}
          onOpenNotifications={() => openProjectDialog({ kind: 'notifications' })}
          onOpenArchive={() => openProjectDialog({ kind: 'archive' })}
          connection={live ? connection : undefined}
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
      ) : ProjectPage && list?.length === 0 ? (
        <div style={{ padding: 32, maxWidth: 560 }}>
          <EmptyState>
            <p style={{ margin: '0 0 6px', fontWeight: 600, color: 'var(--ink)' }}>У вас пока нет проектов</p>
            <p style={{ margin: '0 0 14px' }}>Создайте свой или попросите коллегу пригласить вас: приглашение появится в меню пользователя.</p>
            <Button variant="primary" onClick={() => openProjectDialog({ kind: 'new' })}>
              Создать проект
            </Button>
          </EmptyState>
        </div>
      ) : null}
    </AppShell>
  )
}
