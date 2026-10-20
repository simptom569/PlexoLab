// Лента активности без React: метки типов, чипы фильтров, группы по дням. Порт vActivity макета.

import type { ActivityEvent } from '../../lib/api/types'
import { dayHeading, dayOf } from '../../lib/date'
import type { ActKind } from '../../lib/settings'

/** Метка типа события в строке ленты: подпись и цвет (индекс в TONES). Ключ — категория, которую отдаёт сервер. */
export const KIND_META: Record<string, { label: string; tone: number }> = {
  tasks: { label: 'Задача', tone: 1 },
  comment: { label: 'Комментарий', tone: 7 },
  code: { label: 'Код', tone: 5 },
  doc: { label: 'Документ', tone: 3 },
  release: { label: 'Релиз', tone: 6 },
  file: { label: 'Файл', tone: 2 },
  // категории «Модуль» в макете нет: добавлена по решению владельца (этап 4), цвет из тех же TONES
  module: { label: 'Модуль', tone: 4 },
}

/** Незнакомая категория показывается как задача, как в макете (`meta[...] || meta.tasks`) */
export const kindMeta = (category: string): { label: string; tone: number } => KIND_META[category] ?? KIND_META.tasks!

/** Чипы фильтра «Тип события» (kindChips в макете) */
export const KIND_CHIPS: ReadonlyArray<readonly [ActKind, string]> = [
  ['all', 'Все события'],
  ['tasks', 'Задачи'],
  ['comment', 'Комментарии'],
  ['code', 'Код'],
  ['doc', 'Документы'],
  ['release', 'Релизы'],
  ['file', 'Файлы'],
  ['module', 'Модули'],
]

/** Группа событий одного дня. Время событий уже от новых к старым, поэтому группы идут подряд. */
export type DayGroup = { day: string; heading: string; items: ActivityEvent[] }

export function groupByDay(events: readonly ActivityEvent[], now: Date = new Date()): DayGroup[] {
  const groups: DayGroup[] = []
  for (const event of events) {
    const day = dayOf(event.created_at)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.items.push(event)
    else groups.push({ day, heading: dayHeading(day, now), items: [event] })
  }
  return groups
}

/**
 * Какой участник попадёт в запрос: сохранённый, пока такой есть в команде. Если его удалили (или список ещё не
 * пришёл), лента остаётся «Все», а сохранённое значение не стирается.
 */
export const effectiveWho = (who: string, userIds: readonly string[] | undefined): string =>
  who === 'all' || !userIds || userIds.includes(who) ? who : 'all'
