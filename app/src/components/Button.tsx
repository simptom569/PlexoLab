import type { ComponentProps } from 'react'
import { cx } from '../lib/cx'
import { useReadOnly } from '../lib/link'
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
  /** Кнопка что-то записывает на сервер: пока нет связи, она закрыта */
  write?: boolean
}

export function Button({ variant = 'default', danger, on, className, type = 'button', write, disabled, ...rest }: ButtonProps) {
  const locked = useReadOnly()
  return <button type={type} className={cx(BASE_CLASS[variant], danger && 'danger', on && 'on', className)} disabled={disabled || (write && locked)} {...rest} />
}

type IconButtonProps = Omit<ComponentProps<'button'>, 'children' | 'aria-label'> & {
  /** Подпись для скринридера (aria-label) */
  label: string
  icon: IconName
  /** Иконка 14×14 вместо 18×18 */
  small?: boolean
  /** Кнопка что-то записывает на сервер: пока нет связи, она закрыта */
  write?: boolean
}

export function IconButton({ label, icon, small, className, type = 'button', write, disabled, ...rest }: IconButtonProps) {
  const locked = useReadOnly()
  return (
    <button type={type} className={cx('icon-btn', className)} aria-label={label} disabled={disabled || (write && locked)} {...rest}>
      <Icon name={icon} sm={small} />
    </button>
  )
}
