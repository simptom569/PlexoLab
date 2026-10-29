import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { AppShell } from '../../components/AppShell'
import { Sidebar, type SidebarProject, type SidebarTeam } from '../../components/Sidebar'
import { OfflineBar } from '../../components/OfflineBar'
import { Toast } from '../../components/Toast'
import { Button } from '../../components/Button'
import { EmptyState } from '../../components/Surfaces'
import { useBoard, useMyInvites, useMyTeamInvites, useNotifications, useProjects, useUsers } from '../../lib/api/queries'
import { canCreateProject } from '../../lib/team'
import { useCurrentTeam } from '../../lib/useCurrentTeam'
import { queryClient } from '../../lib/query'
import { useRealtime } from '../../lib/realtime/useRealtime'
import type { PageId } from '../../lib/pages'
import { useSession } from '../../lib/session'
import { useUi } from '../../lib/ui-store'
import { useDark } from '../../lib/useDark'
import { useSearchShortcut } from '../../lib/useSearchShortcut'
import { useLinkWatch } from '../../lib/useLinkWatch'
import { SettingsModal } from '../settings/SettingsModal'
import { useDesktopNotifications } from '../notifications/useDesktopNotifications'
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
    setTeam,
    openTeamMenu,
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
  const teamInvites = useMyTeamInvites()
  const notifications = useNotifications()
  // новое уведомление, пока окно не перед глазами: окошко Windows (только в приложении)
  useDesktopNotifications(notifications.data)
  // пока человек в приложении, держим связь с сервером: чужие изменения приходят сразу, а не при следующем открытии экрана
  const connection = useRealtime(queryClient, live)
  // сеть пропала или вернулась: узнаём сразу, а не по неудачному запросу
  useLinkWatch()
  // Ctrl+K: поиск по названиям
  useSearchShortcut()
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

  // Команда на экране: выбранная в переключателе (docs/TEAMS.md, 11.1). Проекты, вики и файлы относятся к ней.
  const { team, teams } = useCurrentTeam(projects.data)
  // Проекты только этой команды; пока команда не определилась, списка нет (а не «нет проектов»)
  const list = useMemo(() => (team ? projects.data?.filter((p) => p.team_id === team.id) : undefined), [projects.data, team])
  // Открытый проект: сохранённый, если он есть в этой команде, иначе первый её проект
  const projectId = list?.find((p) => p.id === project)?.id ?? list?.[0]?.id ?? null
  useEffect(() => {
    if (projectId && projectId !== project) setProject(projectId)
  }, [projectId, project, setProject])

  // Вики гостю нужна, только если команда её открыла: открытая страница «Вики» уступает доске
  const showWiki = team?.wiki ?? true
  useEffect(() => {
    if (team && !team.wiki && page === 'wiki') setPage('board')
  }, [team, page, setPage])

  const teamItems: SidebarTeam[] = useMemo(() => {
    const items: SidebarTeam[] = teams.map((t) => ({ id: t.id, name: t.name, guest: t.guest }))
    // администратор сервера открыл чужую команду: она не в списке, но должна быть видна как текущая
    if (team && !teams.some((t) => t.id === team.id)) items.push({ id: team.id, name: team.name, guest: false, outside: true })
    return items
  }, [teams, team])

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
  const TeamPage = showWiki ? TEAM_PAGES[page] : undefined

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
          invitesCount={(invites.data?.length ?? 0) + (teamInvites.data?.length ?? 0)}
          canCreateProject={canCreateProject(team)}
          showWiki={showWiki}
          teams={
            team
              ? {
                  items: teamItems,
                  currentId: team.id,
                  caption: team.guest ? `${team.name} · гость` : team.name,
                  menuOpen: menu === 'team',
                  onToggleMenu: () => toggleMenu('team'),
                  onSelect: (id) => {
                    closeMenus()
                    if (id !== team.id) setTeam(id)
                  },
                  onCreate: () => openProjectDialog({ kind: 'new-team' }),
                  onContextMenu: (x, y) => {
                    if (!team.guest) openTeamMenu({ x, y })
                  },
                  onOpenAll: user.is_admin ? () => openProjectDialog({ kind: 'all-teams' }) : undefined,
                }
              : undefined
          }
          onOpenInvites={() => openProjectDialog({ kind: 'invites' })}
          notificationsCount={notifications.data?.unread ?? 0}
          onOpenNotifications={() => openProjectDialog({ kind: 'notifications' })}
          onOpenSearch={() => openProjectDialog({ kind: 'search' })}
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
