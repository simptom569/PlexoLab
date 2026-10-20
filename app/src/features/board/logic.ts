// Чистая логика доски: фильтры, срок, сортировка таблицы, календарь, диаграмма Ганта.
// Перенесено из ctx, dueInfo и vBoard макета; ничего не знает про React и сеть.

import { addDays, DAY, dayInWeek, fd, iso, toMs } from '../../lib/date'
import type { Column, TaskCard, User } from '../../lib/api/types'
import type { Filters, WeekStart } from '../../lib/settings'

/** Значение фильтра «без исполнителя» и «без модуля» */
export const NONE = '-'

const PRIORITY_RANK = { high: 0, med: 1, low: 2 } as const

export const doneColumnIds = (columns: Column[]): Set<string> => new Set(columns.filter((c) => c.is_done).map((c) => c.id))

/** Задача в колонке «Готово» */
export const isDone = (task: TaskCard, doneIds: Set<string>): boolean => !!task.column_id && doneIds.has(task.column_id)

export function isVisible(task: TaskCard, f: Filters, query: string, today: string, doneIds: Set<string>): boolean {
  if (f.who.length && !f.who.includes(task.assignee_id ?? NONE)) return false
  if (f.prio.length && !f.prio.includes(task.priority as Filters['prio'][number])) return false
  if (f.tag.length && !task.tag_ids.some((id) => f.tag.includes(id))) return false
  if (f.module.length && !f.module.includes(task.module_id ?? NONE)) return false
  const due = task.due_date
  if (f.due === 'overdue' && !(due && due < today && !isDone(task, doneIds))) return false
  if (f.due === 'week' && !(due && due >= today && due <= addDays(today, 7))) return false
  if (f.due === 'none' && due) return false
  const q = query.trim().toLowerCase()
  if (q && !`${task.key} ${task.title}`.toLowerCase().includes(q)) return false
  return true
}

/** Срок задачи для показа: «19 окт» и признак просрочки (задача не в «Готово») */
export function dueInfo(task: TaskCard, today: string, doneIds: Set<string>): { text: string; late: boolean } {
  const due = task.due_date
  return { text: fd(due), late: !!due && due < today && !isDone(task, doneIds) }
}

export function splitTasks(tasks: TaskCard[]): { onBoard: TaskCard[]; backlog: TaskCard[] } {
  return { onBoard: tasks.filter((t) => t.column_id), backlog: tasks.filter((t) => !t.column_id) }
}

// ----- Таблица -----

export type SortKey = 'id' | 'title' | 'status' | 'who' | 'prio' | 'due'
export interface Sort {
  key: SortKey
  dir: 1 | -1
}
export const SORTABLE: SortKey[] = ['id', 'title', 'status', 'who', 'prio', 'due']

type SortContext = { columns: Column[]; usersById: Map<string, User> }

function sortValue(t: TaskCard, key: SortKey, ctx: SortContext): number | string {
  switch (key) {
    case 'id':
      return t.number
    case 'title':
      return t.title.toLowerCase()
    case 'status':
      return ctx.columns.findIndex((c) => c.id === t.column_id)
    case 'who':
      // без исполнителя в конце списка
      return (t.assignee_id && ctx.usersById.get(t.assignee_id)?.name) || '\u{10ffff}'
    case 'prio':
      return PRIORITY_RANK[t.priority as keyof typeof PRIORITY_RANK] ?? 1
    case 'due':
      return t.due_date ?? '9999'
  }
}

export function sortTasks(tasks: TaskCard[], sort: Sort, ctx: SortContext): TaskCard[] {
  return tasks.slice().sort((a, b) => {
    const x = sortValue(a, sort.key, ctx)
    const y = sortValue(b, sort.key, ctx)
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
  })
}

/** Клик по заголовку таблицы: тот же столбец меняет направление, другой начинается с возрастания */
export function nextSort(current: Sort, key: SortKey): Sort {
  return { key, dir: current.key === key ? (current.dir === 1 ? -1 : 1) : 1 }
}

// ----- Календарь -----

export interface CalCell {
  date: string
  num: number
  /** День этого месяца (а не соседнего, видного в первой и последней неделе) */
  inMonth: boolean
  today: boolean
  tasks: TaskCard[]
}

/** Ячейки месяца целыми неделями (с понедельника или воскресенья): `year`, `month` (0..11), задачи по сроку */
export function calendarCells(year: number, month: number, tasks: TaskCard[], today: string, weekStart: WeekStart = 'mon'): CalCell[] {
  const first = Date.UTC(year, month, 1)
  const offset = dayInWeek(first, weekStart)
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const weeks = Math.ceil((offset + daysInMonth) / 7)
  const cells: CalCell[] = []
  for (let i = 0; i < weeks * 7; i++) {
    const ms = first - offset * DAY + i * DAY
    const date = iso(ms)
    cells.push({
      date,
      num: new Date(ms).getUTCDate(),
      inMonth: new Date(ms).getUTCMonth() === month,
      today: date === today,
      tasks: tasks.filter((t) => t.due_date === date),
    })
  }
  return cells
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  let m = month + delta
  let y = year
  if (m < 0) {
    m = 11
    y--
  }
  if (m > 11) {
    m = 0
    y++
  }
  return { year: y, month: m }
}

// ----- Ганта -----

export const GANTT_DAYS = 42
/** Окно сдвигается кнопками на 14 дней */
export const GANTT_STEP_DAYS = 14

export interface GanttRow {
  task: TaskCard
  /** «12 окт – 23 окт» или «23 окт», если даты начала нет */
  range: string
  /** Проценты от ширины шкалы */
  left: number
  width: number
}

const clamp = (v: number) => Math.max(0, Math.min(100, v))

/** Начало окна: первый день текущей недели, сдвинутый на `offset` шагов по 14 дней */
export const ganttStart = (weekStart: string, offset: number): string => addDays(weekStart, offset * GANTT_STEP_DAYS)

export function ganttTicks(start: string): Array<{ left: number; label: string }> {
  return [0, 1, 2, 3, 4, 5].map((i) => ({ left: ((i * 7) / GANTT_DAYS) * 100, label: fd(addDays(start, i * 7)) }))
}

export const ganttLabel = (start: string): string => `${fd(start)} – ${fd(addDays(start, GANTT_DAYS - 1))}`

/** Положение «сегодня» на шкале в процентах, null — вне окна */
export function ganttToday(start: string, today: string): number | null {
  const left = ((toMs(today) - toMs(start)) / (GANTT_DAYS * DAY)) * 100
  return left >= 0 && left <= 100 ? left : null
}

/** Полосы задач со сроком, которые попадают в окно, по порядку начала */
export function ganttRows(tasks: TaskCard[], start: string): GanttRow[] {
  const total = GANTT_DAYS * DAY
  const startMs = toMs(start)
  return tasks
    .filter((t) => t.due_date)
    .sort((a, b) => ((a.start_date ?? a.due_date!) < (b.start_date ?? b.due_date!) ? -1 : 1))
    .flatMap((task) => {
      const s = toMs(task.start_date ?? task.due_date!)
      const e = toMs(task.due_date!) + DAY
      const left = ((s - startMs) / total) * 100
      const right = ((e - startMs) / total) * 100
      if (!(right > 0 && left < 100)) return []
      return [
        {
          task,
          range: task.start_date ? `${fd(task.start_date)} – ${fd(task.due_date)}` : fd(task.due_date),
          left: clamp(left),
          width: Math.max(0.8, clamp(right) - clamp(left)),
        },
      ]
    })
}
