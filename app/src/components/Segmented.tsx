import type { CSSProperties } from 'react'
import { useReadOnly } from '../lib/link'

type SegmentedProps<T extends string> = {
  /** aria-label группы */
  label: string
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  style?: CSSProperties
  /** Выбор записывается на сервер: пока нет связи, он закрыт */
  write?: boolean
}

export function Segmented<T extends string>({ label, options, value, onChange, style, write }: SegmentedProps<T>) {
  const locked = useReadOnly()
  return (
    <div className="seg" role="group" aria-label={label} style={style}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? 'on' : undefined}
          aria-pressed={o.value === value}
          disabled={write && locked}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
