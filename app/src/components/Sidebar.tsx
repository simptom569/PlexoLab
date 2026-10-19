import { cx } from '../lib/cx'
import { PAGE_LABELS, type PageId } from '../lib/pages'
import { Avatar } from './Avatar'
import { BrandIcon } from './Brand'
import { Icon } from './Icon'
import type { IconName } from './iconPaths'
import { Anchor, MenuItem, Popover } from './Popover'
import { Count } from './Tag'
import { Sq } from './Shapes'

export type SidebarProject = { id: string; name: string; color: string }
export type SidebarUser = { name: string; role: string; tone: number }

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
}: SidebarProps) {
  return (
    <aside className="side">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 6px' }}>
        <BrandIcon />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
          <strong style={{ fontSize: 15 }}>PlexoLab</strong>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Рабочее пространство</span>
        </div>
      </div>

      <nav aria-label="Основная навигация" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map((n) => (
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
        </div>
        <nav aria-label="Проекты" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {projects.map((p) => (
            <button key={p.id} className={cx('nav', projectId === p.id && 'cur')} type="button" onClick={() => onProject(p.id)}>
              <Sq color={p.color} />
              <span>{p.name}</span>
            </button>
          ))}
        </nav>
      </div>

      <div style={{ marginTop: 'auto', padding: '14px 6px 0', borderTop: '1px solid var(--line)' }}>
        <Anchor>
          <button
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
            <Avatar name={user.name} tone={user.tone} size="lg" decorative />
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
              <strong style={{ fontSize: 14 }}>{user.name}</strong>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{user.role}</span>
            </span>
          </button>
          {userMenuOpen && (
            <Popover small role="menu" aria-label="Меню пользователя" style={{ top: 'auto', bottom: 'calc(100% + 8px)' }}>
              <MenuItem onClick={onToggleTheme}>{dark ? 'Светлая тема' : 'Тёмная тема'}</MenuItem>
            </Popover>
          )}
        </Anchor>
      </div>
    </aside>
  )
}
