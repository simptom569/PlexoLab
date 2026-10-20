import type { ComponentProps } from 'react'
import { cx } from '../lib/cx'

type SwitchProps = Omit<ComponentProps<'button'>, 'onChange' | 'onClick' | 'role' | 'aria-checked' | 'aria-label'> & {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Подпись для скринридера (aria-label) */
  label: string
}

/** Тумблер «включено / выключено» (.switch). Выбор из нескольких вариантов — Segmented. */
export function Switch({ checked, onChange, label, className, type = 'button', ...rest }: SwitchProps) {
  return (
    <button
      type={type}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cx('switch', checked && 'on', className)}
      onClick={() => onChange(!checked)}
      {...rest}
    />
  )
}
