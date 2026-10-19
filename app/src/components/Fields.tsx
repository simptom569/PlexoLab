import type { ComponentProps, CSSProperties } from 'react'
import { cx } from '../lib/cx'
import { Icon } from './Icon'

type SearchFieldProps = {
  /** Скрытая подпись для скринридера */
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  style?: CSSProperties
}

export function SearchField({ label, placeholder, value, onChange, style }: SearchFieldProps) {
  return (
    <label className="search" style={style}>
      <span className="sr">{label}</span>
      <Icon name="search" />
      <input type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

/** Обычное поле (.inp) */
export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={cx('inp', className)} {...rest} />
}

/** Поле-заголовок без рамки (.title-inp): название модуля, вехи, группы ссылок */
export function TitleInput({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={cx('title-inp', className)} {...rest} />
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={cx('inp', className)} {...rest} />
}
