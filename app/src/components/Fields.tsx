import type { ComponentProps, CSSProperties } from 'react'
import { cx } from '../lib/cx'
import { useReadOnly } from '../lib/link'
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

/** Обычное поле (.inp). Пока нет связи, поле только для чтения: набранное пропало бы при отправке. */
export function Input({ className, readOnly, ...rest }: ComponentProps<'input'>) {
  const locked = useReadOnly()
  return <input className={cx('inp', className)} readOnly={readOnly || locked} {...rest} />
}

/** Поле-заголовок без рамки (.title-inp): название модуля, вехи, группы ссылок */
export function TitleInput({ className, readOnly, ...rest }: ComponentProps<'input'>) {
  const locked = useReadOnly()
  return <input className={cx('title-inp', className)} readOnly={readOnly || locked} {...rest} />
}

export function Textarea({ className, readOnly, ...rest }: ComponentProps<'textarea'>) {
  const locked = useReadOnly()
  return <textarea className={cx('inp', className)} readOnly={readOnly || locked} {...rest} />
}
