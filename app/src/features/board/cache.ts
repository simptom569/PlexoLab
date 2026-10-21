// Чистые преобразования кэша доски для оптимистичных обновлений: экран меняется сразу, сервер подтверждает позже.
// Точные позиции присылает сервер (после ответа доска перечитывается), здесь они приблизительные, но порядок верный.

import type {
  Board, Column, Milestone, Subtask, TaskCard, TaskDetail, UpdateColumn, UpdateMilestone, UpdateModule, UpdateTask,
} from '../../lib/api/types'

/** Шаг между позициями, как на сервере (domain::position) */
export const STEP = 1024

const byPosition = <T extends { position: number }>(list: T[]): T[] => list.slice().sort((a, b) => a.position - b.position)

const sameColumn = (t: TaskCard, columnId: string | null): boolean => (t.column_id ?? null) === columnId

/** Позиция в конце колонки (или бэклога) */
function endPosition(tasks: TaskCard[], columnId: string | null): number {
  const last = byPosition(tasks.filter((t) => sameColumn(t, columnId))).pop()
  return (last?.position ?? 0) + STEP
}

/** Перенос задачи: в колонку (null — в бэклог), перед задачей `beforeId` (null — в конец) */
export function placeTask(tasks: TaskCard[], id: string, columnId: string | null, beforeId: string | null): TaskCard[] {
  const moved = tasks.find((t) => t.id === id)
  if (!moved) return tasks
  const rest = tasks.filter((t) => t.id !== id)
  const siblings = byPosition(rest.filter((t) => sameColumn(t, columnId)))
  const at = beforeId ? siblings.findIndex((t) => t.id === beforeId) : -1
  let position: number
  if (at < 0) position = endPosition(rest, columnId)
  else {
    const next = siblings[at]!.position
    const prev = siblings[at - 1]?.position
    position = prev === undefined ? next - STEP : (prev + next) / 2
  }
  return byPosition([...rest, { ...moved, column_id: columnId, position }])
}

/** Переставить колонку перед `beforeId` (null — в конец) */
export function placeColumn(columns: Column[], id: string, beforeId: string | null): Column[] {
  const moved = columns.find((c) => c.id === id)
  if (!moved) return columns
  const rest = byPosition(columns).filter((c) => c.id !== id)
  const at = beforeId ? rest.findIndex((c) => c.id === beforeId) : -1
  if (at < 0) rest.push(moved)
  else rest.splice(at, 0, moved)
  return rest.map((c, i) => ({ ...c, position: (i + 1) * STEP }))
}

/** Колонка удалена: её задачи уходят в конец колонки `moveTo` в прежнем порядке */
export function removeColumn(board: Board, id: string, moveTo: string): Board {
  const moving = byPosition(board.tasks.filter((t) => t.column_id === id))
  const stay = board.tasks.filter((t) => t.column_id !== id)
  let position = endPosition(stay, moveTo)
  const moved = moving.map((t) => ({ ...t, column_id: moveTo, position: (position += STEP) - STEP }))
  return { ...board, columns: board.columns.filter((c) => c.id !== id), tasks: byPosition([...stay, ...moved]) }
}

export function patchColumn(columns: Column[], id: string, patch: UpdateColumn): Column[] {
  const next = columns.map((c) =>
    c.id !== id
      ? c
      : {
          ...c,
          title: patch.title ?? c.title,
          color: patch.color ?? c.color,
          is_done: patch.is_done ?? c.is_done,
        },
  )
  return patch.before_id !== undefined ? placeColumn(next, id, patch.before_id) : next
}

/** Поля из UpdateTask, которые лежат и в карточке доски, и в полной задаче */
function applyCommon<T extends TaskCard | TaskDetail>(task: T, patch: UpdateTask): T {
  const next = { ...task }
  if (patch.title != null) next.title = patch.title
  if (patch.priority != null) next.priority = patch.priority
  if (patch.pr != null) next.pr = patch.pr
  if (patch.tag_ids != null) next.tag_ids = patch.tag_ids
  if (patch.assignee_id !== undefined) next.assignee_id = patch.assignee_id
  if (patch.due_date !== undefined) next.due_date = patch.due_date
  if (patch.start_date !== undefined) next.start_date = patch.start_date
  if (patch.module_id !== undefined) next.module_id = patch.module_id
  if (patch.milestone_id !== undefined) next.milestone_id = patch.milestone_id
  return next
}

/** Правка полей (без переноса: перенос делает placeTask) */
export const patchCard = (card: TaskCard, patch: UpdateTask): TaskCard => applyCommon(card, patch)

export function patchDetail(detail: TaskDetail, patch: UpdateTask): TaskDetail {
  const next = applyCommon(detail, patch)
  if (patch.description != null) next.description = patch.description
  return next
}

export const mapTask = (board: Board, id: string, fn: (t: TaskCard) => TaskCard): Board => ({
  ...board,
  tasks: board.tasks.map((t) => (t.id === id ? fn(t) : t)),
})

export const removeTask = (board: Board, id: string): Board => ({ ...board, tasks: board.tasks.filter((t) => t.id !== id) })

// ----- Модули и вехи (счётчики задач приходят от сервера, здесь они не пересчитываются) -----

export function patchModule(board: Board, id: string, patch: UpdateModule): Board {
  return {
    ...board,
    modules: board.modules.map((m) =>
      m.id !== id
        ? m
        : {
            ...m,
            title: patch.title ?? m.title,
            key: patch.key !== undefined ? patch.key : m.key,
            status: patch.status ?? m.status,
            note: patch.note ?? m.note,
            lead_id: patch.lead_id !== undefined ? patch.lead_id : m.lead_id,
            date_from: patch.date_from !== undefined ? patch.date_from : m.date_from,
            date_to: patch.date_to !== undefined ? patch.date_to : m.date_to,
          },
    ),
  }
}

/** Модуль удалён: задачи остаются, но без модуля */
export function removeModule(board: Board, id: string): Board {
  return {
    ...board,
    modules: board.modules.filter((m) => m.id !== id),
    tasks: board.tasks.map((t) => (t.module_id === id ? { ...t, module_id: null } : t)),
  }
}

/** Вехи идут по возрастанию даты (при равных датах — как пришли) */
export const byDueDate = (list: Milestone[]): Milestone[] => list.slice().sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0))

export function patchMilestone(board: Board, id: string, patch: UpdateMilestone): Board {
  const next = board.milestones.map((m) =>
    m.id !== id ? m : { ...m, title: patch.title ?? m.title, due_date: patch.due_date ?? m.due_date },
  )
  return { ...board, milestones: byDueDate(next) }
}

/** Веха удалена: задачи остаются, но без вехи */
export function removeMilestone(board: Board, id: string): Board {
  return {
    ...board,
    milestones: board.milestones.filter((m) => m.id !== id),
    tasks: board.tasks.map((t) => (t.milestone_id === id ? { ...t, milestone_id: null } : t)),
  }
}

/** Карточка доски из полной задачи (после создания и правок, которые вернул сервер) */
export function cardOf(task: TaskDetail): TaskCard {
  const done = task.subtasks.filter((s) => s.done).length
  return {
    id: task.id,
    project_id: task.project_id,
    number: task.number,
    key: task.key,
    title: task.title,
    column_id: task.column_id,
    position: task.position,
    priority: task.priority,
    pr: task.pr,
    tag_ids: task.tag_ids,
    assignee_id: task.assignee_id,
    due_date: task.due_date,
    start_date: task.start_date,
    module_id: task.module_id,
    milestone_id: task.milestone_id,
    subtasks_total: task.subtasks.length,
    subtasks_done: done,
    updated_at: task.updated_at,
  }
}

/** Счётчики подзадач в карточке по списку подзадач полной задачи */
export const withSubtasks = (card: TaskCard, subtasks: Subtask[]): TaskCard => ({
  ...card,
  subtasks_total: subtasks.length,
  subtasks_done: subtasks.filter((s) => s.done).length,
})
