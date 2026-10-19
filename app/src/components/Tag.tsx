import type { CSSProperties, ReactNode } from 'react'
import { toneAt } from '../lib/tones'

type TagProps = {
  /** Индекс цвета в TONES (0..7), по модулю 8 */
  tone: number
  children: ReactNode
  style?: CSSProperties
}

export function Tag({ tone, children, style }: TagProps) {
  const t = toneAt(tone)
  return (
    <span className="tag" style={{ background: t.bg, color: t.fg, ...style }}>
      {children}
    </span>
  )
}

export function Pill({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span className="pill" style={style}>
      {children}
    </span>
  )
}

type CountProps = {
  children: ReactNode
  /** Фон var(--surface): счётчик на сером фоне (заголовок колонки, группа списка) */
  surface?: boolean
}

export function Count({ children, surface }: CountProps) {
  return (
    <span className="count" style={surface ? { background: 'var(--surface)' } : undefined}>
      {children}
    </span>
  )
}
