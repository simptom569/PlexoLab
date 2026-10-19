import type { ComponentProps, ReactNode } from 'react'
import { cx } from '../lib/cx'

type ChipProps = ComponentProps<'button'> & {
  on?: boolean
  /** Чип-переключатель: добавляет aria-pressed со значением `on` */
  toggle?: boolean
}

export function Chip({ on, toggle, className, type = 'button', ...rest }: ChipProps) {
  return <button type={type} className={cx('chip', on && 'on', className)} aria-pressed={toggle ? !!on : undefined} {...rest} />
}

/** Число на акцентном фоне внутри чипа (например, количество активных фильтров) */
export function Badge({ children }: { children: ReactNode }) {
  return <span className="badge">{children}</span>
}
