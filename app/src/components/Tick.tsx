import type { ComponentProps } from 'react'
import { cx } from '../lib/cx'
import { Icon } from './Icon'

type TickProps = Omit<ComponentProps<'button'>, 'children' | 'aria-label'> & {
  done?: boolean
  /** Подпись для скринридера (aria-label) */
  label: string
}

export function Tick({ done, label, className, type = 'button', ...rest }: TickProps) {
  return (
    <button type={type} className={cx('tick', done && 'done', className)} aria-label={label} {...rest}>
      <Icon name="check" />
    </button>
  )
}
