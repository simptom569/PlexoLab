import type { CSSProperties } from 'react'

type SegmentedProps<T extends string> = {
  /** aria-label группы */
  label: string
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  style?: CSSProperties
}

export function Segmented<T extends string>({ label, options, value, onChange, style }: SegmentedProps<T>) {
  return (
    <div className="seg" role="group" aria-label={label} style={style}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? 'on' : undefined}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
