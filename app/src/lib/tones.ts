// 8 пар «фон / текст» для меток, типов событий и цветов объектов холста (TONES в макете).
// Поле tone у метки и color у объекта холста в БД — индекс в этом массиве.
export const TONES = [
  { bg: 'var(--bug-bg)', fg: 'var(--bug-fg)' },
  { bg: 'var(--feat-bg)', fg: 'var(--feat-fg)' },
  { bg: 'var(--debt-bg)', fg: 'var(--debt-fg)' },
  { bg: 'var(--a-bg)', fg: 'var(--a-fg)' },
  { bg: 'var(--b-bg)', fg: 'var(--b-fg)' },
  { bg: 'var(--c-bg)', fg: 'var(--c-fg)' },
  { bg: 'var(--d-bg)', fg: 'var(--d-fg)' },
  { bg: 'var(--e-bg)', fg: 'var(--e-fg)' },
] as const

export const toneAt = (index: number) => TONES[((index % TONES.length) + TONES.length) % TONES.length]

// users.tone 0..4 → .av-a … .av-e
export const AVATAR_CLASSES = ['av-a', 'av-b', 'av-c', 'av-d', 'av-e'] as const
