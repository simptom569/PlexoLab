export type Priority = 'high' | 'med' | 'low'

export const PRIORITY_LABELS: Record<Priority, string> = { high: 'Высокий', med: 'Средний', low: 'Низкий' }

/** Статус модуля и релиза: переключается кликом по кругу (stNext в макете) */
export type WorkStatus = 'plan' | 'progress' | 'done'
export const NEXT_STATUS: Record<WorkStatus, WorkStatus> = { plan: 'progress', progress: 'done', done: 'plan' }
export const MODULE_STATUS_LABELS: Record<WorkStatus, string> = { plan: 'Запланирован', progress: 'В работе', done: 'Завершён' }
export const RELEASE_STATUS_LABELS: Record<WorkStatus, string> = { plan: 'Запланирован', progress: 'Готовится', done: 'Выпущен' }
