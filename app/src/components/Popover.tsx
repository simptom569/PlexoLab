import type { ComponentProps, CSSProperties, ReactNode } from 'react'
import { cx } from '../lib/cx'
import { useReadOnly } from '../lib/link'

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
  /** Выбор записывается на сервер: пока нет связи, он закрыт */
  write?: boolean
}

export function Opt({ on, swatch, className, type = 'button', children, write, disabled, ...rest }: OptProps) {
  const locked = useReadOnly()
  return (
    <button type={type} className={cx('opt', on && 'on', className)} aria-pressed={on === undefined ? undefined : on} disabled={disabled || (write && locked)} {...rest}>
      {swatch && <span className="sw" style={{ background: swatch }} />}
      {children}
    </button>
  )
}

type MenuItemProps = ComponentProps<'button'> & {
  danger?: boolean
  /** Пункт что-то записывает на сервер: пока нет связи, он закрыт */
  write?: boolean
}

export function MenuItem({ danger, className, type = 'button', write, disabled, ...rest }: MenuItemProps) {
  const locked = useReadOnly()
  return <button type={type} role="menuitem" className={cx('menu-item', danger && 'danger', className)} disabled={disabled || (write && locked)} {...rest} />
}

/** Прозрачная подложка на весь экран: клик мимо поповера закрывает его */
export function Backdrop({ onClick }: { onClick: () => void }) {
  return <button className="backdrop" type="button" aria-label="Закрыть меню" onClick={onClick} />
}
