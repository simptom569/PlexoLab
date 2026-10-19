import type { ComponentProps } from 'react'
import { cx } from '../lib/cx'
import { Icon } from './Icon'
import type { IconName } from './iconPaths'

type Variant = 'default' | 'primary' | 'ghost'

const BASE_CLASS: Record<Variant, string> = { default: 'btn', primary: 'btn-primary', ghost: 'btn-ghost' }

type ButtonProps = ComponentProps<'button'> & {
  variant?: Variant
  /** Только для variant="default": красный текст (.btn.danger) */
  danger?: boolean
  /** Только для variant="default": включённое состояние (.btn.on) */
  on?: boolean
}

export function Button({ variant = 'default', danger, on, className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={cx(BASE_CLASS[variant], danger && 'danger', on && 'on', className)} {...rest} />
}

type IconButtonProps = Omit<ComponentProps<'button'>, 'children' | 'aria-label'> & {
  /** Подпись для скринридера (aria-label) */
  label: string
  icon: IconName
  /** Иконка 14×14 вместо 18×18 */
  small?: boolean
}

export function IconButton({ label, icon, small, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} className={cx('icon-btn', className)} aria-label={label} {...rest}>
      <Icon name={icon} sm={small} />
    </button>
  )
}
