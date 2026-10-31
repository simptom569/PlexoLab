import { useRef } from 'react'
import { cx } from '../lib/cx'
import { CONNECTION_VIEW } from '../lib/connection-view'
import type { ConnectionStatus } from '../lib/realtime/connection'
import { PAGE_LABELS, type PageId } from '../lib/pages'
import { Avatar } from './Avatar'
import { BrandIcon } from './Brand'
import { Icon } from './Icon'
import { IconButton } from './Button'
import type { IconName } from './iconPaths'
import { Anchor, MenuItem, Popover } from './Popover'
import { Count } from './Tag'
import { Sq } from './Shapes'

export type SidebarProject = { id: string; name: string; color: string }
/** Команда в переключателе (docs/TEAMS.md, 11.1). `guest`: я здесь только гость; `outside`: чужая команда, которую открыл администратор сервера. */
export type SidebarTeam = { id: string; name: string; guest: boolean; outside?: boolean }
export type SidebarUser = { name: string; role: string; tone: number; email: string }

// Точка связи с сервером на аватаре. В макете её нет (добавлена по плану этапа 8), поэтому собрана из его переменных и
// лежит поверх аватара, не меняя размеров и положения ничего вокруг.
function ConnectionDot({ status }: { status: ConnectionStatus }) {
  const { color, text } = CONNECTION_VIEW[status]
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      data-connection={status}
      style={{ position: 'absolute', right: -1, bottom: -1, width: 10, height: 10, borderRadius: '50%', background: color, boxShadow: '0 0 0 2px var(--surface)' }}
    />
  )
}

const NAV: Array<{ id: PageId; icon: IconName }> = [
  { id: 'board', icon: 'board' },
  { id: 'backlog', icon: 'backlog' },
  { id: 'modules', icon: 'modules' },
  { id: 'releases', icon: 'releases' },
  { id: 'wiki', icon: 'wiki' },
  { id: 'docs', icon: 'docs' },
  { id: 'activity', icon: 'activity' },
  { id: 'links', icon: 'link' },
]

type SidebarProps = {
  page: PageId
  onPage: (page: PageId) => void
  backlogCount: number
  projects: SidebarProject[]
  projectId: string
  onProject: (id: string) => void
  user: SidebarUser
  userMenuOpen: boolean
  onToggleUserMenu: () => void
  dark: boolean
  onToggleTheme: () => void
  /** trigger — карточка пользователя: на неё вернётся фокус, когда окно настроек закроют */
  onOpenSettings: (trigger: HTMLElement | null) => void
  onLogout: () => void
  /** Состояние связи для точки на аватаре; не задано — точки нет (витрина компонентов) */
  connection?: ConnectionStatus
  /** Адрес сервера для шапки меню пользователя */
  serverUrl?: string | null
  /** «+» у заголовка «Проекты» (виден при наведении) */
  onNewProject: () => void
  /** Правая кнопка на проекте: меню проекта у курсора */
  onProjectMenu: (id: string, x: number, y: number) => void
  /** Сколько приглашений ждёт ответа: число в меню пользователя и точка у имени */
  invitesCount: number
  onOpenInvites: () => void
  /** Сколько уведомлений не прочитано: число рядом с пунктом меню и точка у имени. Пункта нет, если не задано (витрина). */
  notificationsCount?: number
  onOpenNotifications?: () => void
  /** Окно поиска (Ctrl+K). Пункта нет, если не задано (витрина). */
  onOpenSearch?: () => void
  /** Найдена новая версия приложения: точка у имени и пункт «Доступна версия …», он открывает «О программе». Нет версии — нет и пункта. */
  updateVersion?: string | null
  onOpenUpdate?: (trigger: HTMLElement | null) => void
  onOpenArchive: () => void
  /** Переключатель команды (вариант Б): название текущей команды вместо подписи «Рабочее пространство». Не задано — подпись как в макете (витрина). */
  teams?: {
    items: SidebarTeam[]
    currentId: string | null
    /** Подпись под названием приложения: название текущей команды */
    caption: string
    menuOpen: boolean
    onToggleMenu: () => void
    onSelect: (id: string) => void
    onCreate: () => void
    /** Правая кнопка на блоке PlexoLab: меню команды у курсора */
    onContextMenu: (x: number, y: number) => void
    /** Для администратора сервера: окно «Все команды сервера» */
    onOpenAll?: () => void
  }
  /** «+» у заголовка «Проекты» есть не везде: в гостевой команде его нет */
  canCreateProject?: boolean
  /** Пункт «Вики» есть не везде: в гостевой команде он только при включённой настройке команды */
  showWiki?: boolean
}

/** Подпись точки у имени: что ждёт человека */
function attentionLabel(invites: number, notifications: number, update: boolean): string {
  const base =
    invites > 0 && notifications > 0
      ? 'Есть приглашения и непрочитанные уведомления'
      : invites > 0
        ? 'Есть приглашения'
        : notifications > 0
          ? 'Есть непрочитанные уведомления'
          : ''
  if (!update) return base
  return base ? `${base}, есть новая версия приложения` : 'Есть новая версия приложения'
}

/**
 * Переключатель команды (вариант Б, утверждён владельцем): блок PlexoLab стал кнопкой, под названием приложения стоит название
 * текущей команды, при наведении справа появляется ▾. Нажатие открывает меню команд, правая кнопка меню команды. В покое
 * выглядит как в макете (подпись «Рабочее пространство» теперь название команды).
 */
function TeamSwitcher({ teams }: { teams: NonNullable<SidebarProps['teams']> }) {
  return (
    <Anchor>
      <button
        className="brand-btn"
        type="button"
        aria-haspopup="menu"
        aria-expanded={teams.menuOpen}
        onClick={teams.onToggleMenu}
        onContextMenu={(e) => {
          e.preventDefault()
          teams.onContextMenu(e.clientX, e.clientY)
        }}
      >
        <BrandIcon />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, minWidth: 0 }}>
          <strong style={{ fontSize: 15 }}>PlexoLab</strong>
          <span className="cap">
            <span>{teams.caption}</span>
            <span className="chev" aria-hidden="true">
              <Icon name="chevronDown" sm />
            </span>
          </span>
        </div>
      </button>
      {teams.menuOpen && (
        <Popover small role="menu" aria-label="Команды" style={{ left: 0, right: 0, minWidth: 0 }}>
          <div className="pop-title" style={{ margin: '6px 10px 2px' }}>
            Команды
          </div>
          {teams.items.map((t) => (
            <MenuItem key={t.id} role="menuitemradio" aria-checked={t.id === teams.currentId} onClick={() => teams.onSelect(t.id)}>
              {t.id === teams.currentId ? <Icon name="check" sm /> : <span className="menu-gap" />}
              <span className="team-name">{t.name}</span>
              {t.guest && <span className="tag-guest">гость</span>}
              {t.outside && <span className="tag-guest">не ваша</span>}
            </MenuItem>
          ))}
          <div role="separator" style={{ height: 1, margin: '2px 0', background: 'var(--line)' }} />
          <MenuItem write onClick={teams.onCreate}>
            <Icon name="plus" sm />
            Создать команду
          </MenuItem>
          {teams.onOpenAll && (
            <MenuItem onClick={teams.onOpenAll}>
              <Icon name="server" sm />
              Все команды сервера
            </MenuItem>
          )}
        </Popover>
      )}
    </Anchor>
  )
}

export function Sidebar({
  page,
  onPage,
  backlogCount,
  projects,
  projectId,
  onProject,
  user,
  userMenuOpen,
  onToggleUserMenu,
  dark,
  onToggleTheme,
  onOpenSettings,
  onLogout,
  connection,
  serverUrl,
  onNewProject,
  onProjectMenu,
  invitesCount,
  onOpenInvites,
  notificationsCount = 0,
  onOpenNotifications,
  onOpenSearch,
  updateVersion,
  onOpenUpdate,
  onOpenArchive,
  teams,
  canCreateProject = true,
  showWiki = true,
}: SidebarProps) {
  const userButton = useRef<HTMLButtonElement>(null)
  return (
    <aside className="side">
      {teams ? (
        <TeamSwitcher teams={teams} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 6px' }}>
          <BrandIcon />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <strong style={{ fontSize: 15 }}>PlexoLab</strong>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Рабочее пространство</span>
          </div>
        </div>
      )}

      <nav aria-label="Основная навигация" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.filter((n) => n.id !== 'wiki' || showWiki).map((n) => (
          <button
            key={n.id}
            className={cx('nav', page === n.id && 'on')}
            type="button"
            aria-current={page === n.id ? 'page' : 'false'}
            onClick={() => onPage(n.id)}
          >
            <Icon name={n.icon} />
            <span style={{ flex: 1 }}>{PAGE_LABELS[n.id]}</span>
            {n.id === 'backlog' && <Count>{backlogCount}</Count>}
          </button>
        ))}
      </nav>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div
          className="proj-head"
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'var(--muted)',
            padding: '0 10px',
          }}
        >
          Проекты
          {canCreateProject && <IconButton write className="proj-add" icon="plus" small label="Новый проект" onClick={onNewProject} />}
        </div>
        <nav aria-label="Проекты" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {projects.map((p) => (
            <button
              key={p.id}
              className={cx('nav', projectId === p.id && 'cur')}
              type="button"
              onClick={() => onProject(p.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                onProjectMenu(p.id, e.clientX, e.clientY)
              }}
            >
              <Sq color={p.color} />
              <span>{p.name}</span>
            </button>
          ))}
        </nav>
      </div>

      <div style={{ marginTop: 'auto', padding: '14px 6px 0', borderTop: '1px solid var(--line)' }}>
        <Anchor>
          <button
            ref={userButton}
            type="button"
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            onClick={onToggleUserMenu}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: 0,
              border: 0,
              background: 'transparent',
              textAlign: 'left',
            }}
          >
            <span style={{ position: 'relative', display: 'inline-flex', flex: 'none' }}>
              <Avatar name={user.name} tone={user.tone} size="lg" decorative />
              {connection && <ConnectionDot status={connection} />}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
              <strong style={{ fontSize: 14 }}>
                {user.name}
                {(invitesCount + notificationsCount > 0 || Boolean(updateVersion)) && (
                  <span className="invite-dot" role="img" aria-label={attentionLabel(invitesCount, notificationsCount, Boolean(updateVersion))} />
                )}
              </strong>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{user.role}</span>
            </span>
          </button>
          {userMenuOpen && (
            <Popover small role="menu" aria-label="Меню пользователя" style={{ top: 'auto', bottom: 'calc(100% + 8px)' }}>
              <div role="group" aria-label="Учётная запись" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 10px 8px', minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={user.email}>
                  {user.email}
                </span>
                {connection && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }} title={CONNECTION_VIEW[connection].text}>
                    <span className="sw" style={{ background: CONNECTION_VIEW[connection].color }} />
                    {CONNECTION_VIEW[connection].label}
                  </span>
                )}
                {serverUrl && (
                  <span className="mono" style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={serverUrl}>
                    {serverUrl}
                  </span>
                )}
              </div>
              <div role="separator" style={{ height: 1, margin: '2px 0', background: 'var(--line)' }} />
              {updateVersion && onOpenUpdate && (
                <MenuItem onClick={() => onOpenUpdate(userButton.current)}>
                  <Icon name="upload" sm />
                  Доступна версия {updateVersion}
                </MenuItem>
              )}
              <MenuItem onClick={() => onOpenSettings(userButton.current)}>
                <Icon name="gear" sm />
                Настройки
              </MenuItem>
              {onOpenSearch && (
                <MenuItem onClick={onOpenSearch}>
                  <Icon name="search" sm />
                  Поиск
                  <span aria-hidden="true" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}>
                    Ctrl+K
                  </span>
                </MenuItem>
              )}
              {onOpenNotifications && (
                <MenuItem onClick={onOpenNotifications}>
                  <Icon name="bell" sm />
                  Уведомления
                  {notificationsCount > 0 && (
                    <span style={{ marginLeft: 'auto' }}>
                      <Count>{notificationsCount}</Count>
                    </span>
                  )}
                </MenuItem>
              )}
              <MenuItem onClick={onOpenInvites}>
                <Icon name="user" sm />
                Приглашения
                {invitesCount > 0 && (
                  <span style={{ marginLeft: 'auto' }}>
                    <Count>{invitesCount}</Count>
                  </span>
                )}
              </MenuItem>
              <MenuItem onClick={onOpenArchive}>
                <Icon name="folder" sm />
                Архив проектов
              </MenuItem>
              <MenuItem onClick={onToggleTheme}>
                <Icon name={dark ? 'sun' : 'moon'} sm />
                {dark ? 'Светлая тема' : 'Тёмная тема'}
              </MenuItem>
              <MenuItem onClick={onLogout}>
                <Icon name="logout" sm />
                Выйти
              </MenuItem>
            </Popover>
          )}
        </Anchor>
      </div>
    </aside>
  )
}
