import type { ComponentProps, CSSProperties, ReactNode } from 'react'
import { cx } from '../lib/cx'

/** Обёртка с position:relative: поповер встаёт под кнопкой, рядом с которой лежит */
export function Anchor({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ position: 'relative', ...style }}>{children}</div>
}

type PopoverProps = ComponentProps<'div'> & {
  /** Прижать к правому краю кнопки (.pop.right) */
  right?: boolean
  /** Компактное меню (.pop.sm) */
  small?: boolean
}

export function Popover({ right, small, className, role = 'dialog', ...rest }: PopoverProps) {
  return <div className={cx('pop', right && 'right', small && 'sm', className)} role={role} {...rest} />
}

export function PopoverTitle({ children }: { children: ReactNode }) {
  return <div className="pop-title">{children}</div>
}

export function PopoverItems({ children }: { children: ReactNode }) {
  return <div className="pop-items">{children}</div>
}

type OptProps = ComponentProps<'button'> & {
  /** Выбрано (.opt.on и aria-pressed). Если не задано, aria-pressed не ставится. */
  on?: boolean
  /** Цветной кружок перед подписью (.sw) */
  swatch?: string
}

export function Opt({ on, swatch, className, type = 'button', children, ...rest }: OptProps) {
  return (
    <button type={type} className={cx('opt', on && 'on', className)} aria-pressed={on === undefined ? undefined : on} {...rest}>
      {swatch && <span className="sw" style={{ background: swatch }} />}
      {children}
    </button>
  )
}

type MenuItemProps = ComponentProps<'button'> & { danger?: boolean }

export function MenuItem({ danger, className, type = 'button', ...rest }: MenuItemProps) {
  return <button type={type} role="menuitem" className={cx('menu-item', danger && 'danger', className)} {...rest} />
}

/** Прозрачная подложка на весь экран: клик мимо поповера закрывает его */
export function Backdrop({ onClick }: { onClick: () => void }) {
  return <button className="backdrop" type="button" aria-label="Закрыть меню" onClick={onClick} />
}
