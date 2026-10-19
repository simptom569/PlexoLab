import type { CSSProperties } from 'react'
import { PRIORITY_LABELS, type Priority } from '../lib/domain'

type PriorityBarsProps = {
  prio: Priority
  /** С подписью «Высокий приоритет» для скринридера. Без неё значок декоративный (текст рядом). */
  labelled?: boolean
  style?: CSSProperties
}

export function PriorityBars({ prio, labelled, style }: PriorityBarsProps) {
  return (
    <span
      className={`prio p-${prio}`}
      style={style}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? `${PRIORITY_LABELS[prio]} приоритет` : undefined}
    >
      <span />
      <span />
      <span />
    </span>
  )
}
