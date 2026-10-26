import type { CSSProperties, ReactNode } from 'react'
import { cx } from '../lib/cx'
import { Backdrop } from './Popover'

// Корневой контейнер макета. Единственное отличие: min-height 100vh вместо 1380px (рабочее поле артефакта).
const ROOT_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  minHeight: '100vh',
  background: 'var(--bg)',
  color: 'var(--ink)',
  fontFamily: "'Manrope',system-ui,sans-serif",
  fontSize: 14,
  lineHeight: 1.45,
}

type AppShellProps = {
  dark: boolean
  sidebar: ReactNode
  /** Открыт поповер или меню: поверх контента лежит прозрачная подложка закрытия */
  menuOpen: boolean
  onCloseMenus: () => void
  /** Правая панель и подобное: в макете лежит рядом с <main>, а не внутри */
  overlay?: ReactNode
  /** Полоска сверху рабочей области (нет связи) */
  notice?: ReactNode
  children: ReactNode
}

export function AppShell({ dark, sidebar, menuOpen, onCloseMenus, overlay, notice, children }: AppShellProps) {
  return (
    <div className={cx('app', dark && 'dark')} style={ROOT_STYLE}>
      {sidebar}
      <main className="main">
        {notice}
        {menuOpen && <Backdrop onClick={onCloseMenus} />}
        {children}
      </main>
      {overlay}
    </div>
  )
}

/** Корень для страниц без боковой панели (витрина компонентов) */
export function ThemeRoot({ dark, children }: { dark: boolean; children: ReactNode }) {
  return (
    <div className={cx('app', dark && 'dark')} style={ROOT_STYLE}>
      {children}
    </div>
  )
}
