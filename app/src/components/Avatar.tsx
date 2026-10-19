import type { CSSProperties } from 'react'
import { cx } from '../lib/cx'
import { AVATAR_CLASSES } from '../lib/tones'

type AvatarProps = {
  /** Имя участника; null или не задано — «без исполнителя» (пунктирный кружок) */
  name?: string | null
  /** users.tone: 0..4 → .av-a … .av-e */
  tone?: number
  size?: 'sm' | 'lg'
  /** Своя буква вместо первой буквы имени */
  initial?: string
  /** Чисто декоративный кружок (подпись рядом в тексте): aria-hidden вместо role="img" */
  decorative?: boolean
  /** Подпись для пустого аватара */
  emptyLabel?: string
  style?: CSSProperties
}

export function Avatar({ name, tone = 0, size, initial, decorative, emptyLabel = 'Без исполнителя', style }: AvatarProps) {
  const none = name == null
  const letter = initial ?? (none ? '–' : name.trim().charAt(0).toUpperCase())
  const label = none ? emptyLabel : name
  const toneClass = none ? 'av-none' : AVATAR_CLASSES[((tone % AVATAR_CLASSES.length) + AVATAR_CLASSES.length) % AVATAR_CLASSES.length]
  return (
    <span
      className={cx('avatar', size, toneClass)}
      style={style}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
      title={decorative ? undefined : label}
    >
      {letter}
    </span>
  )
}
