import type { ComponentProps } from 'react'
import { cx } from '../lib/cx'
import { useReadOnly } from '../lib/link'
import { Icon } from './Icon'

type TickProps = Omit<ComponentProps<'button'>, 'children' | 'aria-label'> & {
  done?: boolean
  /** Подпись для скринридера (aria-label) */
  label: string
  /** Отметка записывается на сервер: пока нет связи, она закрыта */
  write?: boolean
}

export function Tick({ done, label, className, type = 'button', write, disabled, ...rest }: TickProps) {
  const locked = useReadOnly()
  return (
    <button type={type} className={cx('tick', done && 'done', className)} aria-label={label} disabled={disabled || (write && locked)} {...rest}>
      <Icon name="check" />
    </button>
  )
}
