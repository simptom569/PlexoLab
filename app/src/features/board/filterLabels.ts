import type { DisplayKey, DueFilter, View } from '../../lib/settings'

export const DUE_LABELS: Record<DueFilter, string> = { any: 'Любой', overdue: 'Просрочено', week: 'На этой неделе', none: 'Без срока' }
export const DISPLAY_LABELS: Record<DisplayKey, string> = {
  who: 'Исполнитель', due: 'Срок', tags: 'Метки', prio: 'Приоритет', subs: 'Подзадачи', pr: 'PR', module: 'Модуль',
}
export const VIEW_LABELS: Record<View, string> = { board: 'Доска', list: 'Список', table: 'Таблица', cal: 'Календарь', gantt: 'Ганта' }

/** Число включённых фильтров (срок «Любой» не считается) */
export const countFilters = (f: { who: string[]; prio: string[]; tag: string[]; module: string[]; due: DueFilter }): number =>
  f.who.length + f.prio.length + f.tag.length + f.module.length + (f.due !== 'any' ? 1 : 0)
