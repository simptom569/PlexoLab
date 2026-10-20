// Календарик в полях с датой: сетка месяца и перемещение по дням клавишами. Всё считается по UTC, как в date.ts.

import { DAY, addDays, dayInWeek, iso, toMs, weekStartOf } from './date'
import type { WeekStart } from './settings'

/** Настоящая дата `ГГГГ-ММ-ДД` (30 февраля и пустая строка — нет) */
export const isIsoDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(toMs(s)) === s

export type DateEdit = { kind: 'keep' } | { kind: 'revert' } | { kind: 'save'; value: string }

/**
 * Что делать с полем даты, когда человек закончил его править (ушёл из поля, нажал Enter).
 * `typed` — значение поля (пусто и при неполной дате), `incomplete` — введена только часть даты (`validity.badInput`),
 * `saved` — то, что сохранено. Пустое поле — это «стереть дату», но только там, где даты может не быть.
 */
export function finishDateEdit(typed: string, incomplete: boolean, saved: string, clearable: boolean): DateEdit {
  if (incomplete) return { kind: 'revert' }
  if (typed === saved) return { kind: 'keep' }
  if (typed === '' && !clearable) return { kind: 'revert' }
  return { kind: 'save', value: typed }
}

export interface PickerDay {
  date: string
  num: number
  /** День показанного месяца; остальные — хвосты соседних месяцев */
  inMonth: boolean
}

/** Шесть недель подряд (42 дня): окно не меняет высоту, когда листаешь месяцы */
export function pickerDays(year: number, month: number, weekStart: WeekStart): PickerDay[] {
  const first = Date.UTC(year, month, 1)
  const start = first - dayInWeek(first, weekStart) * DAY
  return Array.from({ length: 42 }, (_, i) => {
    const ms = start + i * DAY
    const d = new Date(ms)
    return { date: iso(ms), num: d.getUTCDate(), inMonth: d.getUTCMonth() === month }
  })
}

/** Сдвиг на месяцы с обрезкой дня: 31 января + 1 месяц = 28 (29) февраля */
export function addMonths(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const first = new Date(Date.UTC(y!, m! - 1 + delta, 1))
  const year = first.getUTCFullYear()
  const month = first.getUTCMonth()
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return iso(Date.UTC(year, month, Math.min(d!, last)))
}

/**
 * Куда уходит выбранный день по клавише: стрелки — на день и неделю, PageUp/PageDown — на месяц (с Shift — на год),
 * Home/End — в начало и конец недели. Для остальных клавиш — `null`.
 */
export function moveCursor(date: string, key: string, weekStart: WeekStart, shift = false): string | null {
  switch (key) {
    case 'ArrowLeft':
      return addDays(date, -1)
    case 'ArrowRight':
      return addDays(date, 1)
    case 'ArrowUp':
      return addDays(date, -7)
    case 'ArrowDown':
      return addDays(date, 7)
    case 'PageUp':
      return addMonths(date, shift ? -12 : -1)
    case 'PageDown':
      return addMonths(date, shift ? 12 : 1)
    case 'Home':
      return weekStartOf(date, weekStart)
    case 'End':
      return addDays(weekStartOf(date, weekStart), 6)
    default:
      return null
  }
}
