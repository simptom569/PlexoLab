import type { CSSProperties } from 'react'
import { cx } from '../lib/cx'

type ProgressBarProps = {
  /** 0..100 */
  pct: number
  /** Тонкая полоска 4px (.bar.sm) */
  small?: boolean
  /** Зелёная заливка (.fill.ok) для завершённого */
  ok?: boolean
  style?: CSSProperties
}

export function ProgressBar({ pct, small, ok, style }: ProgressBarProps) {
  return (
    <div className={cx('bar', small && 'sm')} style={style}>
      <div className={cx('fill', ok && 'ok')} style={{ width: `${pct}%` }} />
    </div>
  )
}
