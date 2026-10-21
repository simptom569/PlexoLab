// Изменения данных доски. Правки, переносы и удаления показываются на экране сразу (оптимистично) и откатываются,
// если сервер отказал. Создание ждёт ответа сервера: номер WEB-N и позицию выдаёт он.

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api/client'
import { keys } from '../../lib/api/queries'
import type {
  Board, Column, Comment, CreateColumn, Milestone, Module, Subtask, Tag, TaskDetail, UpdateColumn, UpdateMilestone, UpdateModule,
  UpdateSubtask, UpdateTask,
} from '../../lib/api/types'
import {
  byDueDate, cardOf, mapTask, patchCard, patchColumn, patchDetail, patchMilestone, patchModule, placeTask, removeColumn, removeMilestone,
  removeModule, removeTask, withSubtasks,
} from './cache'

type Snapshot = { board?: Board; detail?: TaskDetail; taskId?: string }

interface Spec<V, R> {
  mutationFn: (vars: V) => Promise<R>
  /** Задача, чья полная запись тоже меняется на экране */
  taskId?: (vars: V) => string | undefined
  board?: (board: Board, vars: V) => Board
  detail?: (detail: TaskDetail, vars: V) => TaskDetail
  /** Счётчики подзадач в карточке пересчитать по полной задаче */
  syncSubtasks?: boolean
  /**
   * Ответ сервера → кэш (для того, что нельзя показать до ответа). `last`: больше правок в пути нет;
   * иначе ответ мог устареть относительно более свежей правки на экране, и записывать его нельзя.
   */
  onSuccess?: (data: R, vars: V, qc: QueryClient, projectId: string, last: boolean) => void
}

function useBoardMutation<V, R = void>(projectId: string, spec: Spec<V, R>) {
  const qc = useQueryClient()
  const boardKey = keys.board(projectId)
  const mutationKey = ['board-edit', projectId]

  return useMutation<R, Error, V, Snapshot>({
    mutationKey,
    mutationFn: spec.mutationFn,
    onMutate: async (vars) => {
      const taskId = spec.taskId?.(vars)
      await qc.cancelQueries({ queryKey: boardKey })
      if (taskId) await qc.cancelQueries({ queryKey: keys.task(taskId) })
      const snapshot: Snapshot = { board: qc.getQueryData<Board>(boardKey), detail: taskId ? qc.getQueryData<TaskDetail>(keys.task(taskId)) : undefined, taskId }

      let detailAfter: TaskDetail | undefined
      if (spec.detail && taskId && snapshot.detail) {
        detailAfter = spec.detail(snapshot.detail, vars)
        qc.setQueryData(keys.task(taskId), detailAfter)
      }
      if (snapshot.board && (spec.board || (spec.syncSubtasks && detailAfter))) {
        let next = snapshot.board
        if (spec.board) next = spec.board(next, vars)
        if (spec.syncSubtasks && detailAfter && taskId) next = mapTask(next, taskId, (t) => withSubtasks(t, detailAfter.subtasks))
        qc.setQueryData(boardKey, next)
      }
      return snapshot
    },
    onError: (_error, _vars, snapshot) => {
      if (!snapshot) return
      if (snapshot.board) qc.setQueryData(boardKey, snapshot.board)
      if (snapshot.taskId && snapshot.detail) qc.setQueryData(keys.task(snapshot.taskId), snapshot.detail)
    },
    onSuccess: (data, vars) => spec.onSuccess?.(data, vars, qc, projectId, qc.isMutating({ mutationKey }) <= 1),
    onSettled: (_data, _error, vars) => {
      // пока идут другие правки, доску не перечитываем: иначе она «мигнёт» старыми данными
      if (qc.isMutating({ mutationKey }) > 1) return
      void qc.invalidateQueries({ queryKey: boardKey })
      const taskId = spec.taskId?.(vars)
      if (taskId) void qc.invalidateQueries({ queryKey: keys.task(taskId) })
    },
  })
}

export function useBoardMutations(projectId: string) {
  const moveTask = useBoardMutation<{ id: string; columnId: string | null; beforeId: string | null }, TaskDetail>(projectId, {
    mutationFn: ({ id, columnId, beforeId }) => api.patch<TaskDetail>(`/tasks/${id}`, { column_id: columnId, before_id: beforeId }),
    taskId: (v) => v.id,
    board: (b, v) => ({ ...b, tasks: placeTask(b.tasks, v.id, v.columnId, v.beforeId) }),
    detail: (d, v) => ({ ...d, column_id: v.columnId }),
  })

  const updateTask = useBoardMutation<{ id: string; patch: UpdateTask }, TaskDetail>(projectId, {
    mutationFn: ({ id, patch }) => api.patch<TaskDetail>(`/tasks/${id}`, patch),
    taskId: (v) => v.id,
    board: (b, v) => mapTask(b, v.id, (t) => patchCard(t, v.patch)),
    detail: (d, v) => patchDetail(d, v.patch),
    onSuccess: (data, _v, qc, _pid, last) => last && qc.setQueryData(keys.task(data.id), data),
  })

  const createTask = useBoardMutation<{ columnId: string | null; title: string }, TaskDetail>(projectId, {
    mutationFn: ({ columnId, title }) => api.post<TaskDetail>(`/projects/${projectId}/tasks`, { column_id: columnId, title }),
    onSuccess: (task, _v, qc, pid) => {
      qc.setQueryData(keys.task(task.id), task)
      qc.setQueryData<Board>(keys.board(pid), (b) => b && { ...b, tasks: [...b.tasks.filter((t) => t.id !== task.id), cardOf(task)] })
    },
  })

  const deleteTask = useBoardMutation<{ id: string }>(projectId, {
    mutationFn: ({ id }) => api.delete(`/tasks/${id}`),
    board: (b, v) => removeTask(b, v.id),
    onSuccess: (_d, v, qc) => qc.removeQueries({ queryKey: keys.task(v.id) }),
  })

  const createColumn = useBoardMutation<CreateColumn, Column>(projectId, {
    mutationFn: (body) => api.post<Column>(`/projects/${projectId}/columns`, body),
    onSuccess: (column, _v, qc, pid) =>
      qc.setQueryData<Board>(keys.board(pid), (b) => b && { ...b, columns: [...b.columns.filter((c) => c.id !== column.id), column] }),
  })

  const updateColumn = useBoardMutation<{ id: string; patch: UpdateColumn }, Column>(projectId, {
    mutationFn: ({ id, patch }) => api.patch<Column>(`/columns/${id}`, patch),
    board: (b, v) => ({ ...b, columns: patchColumn(b.columns, v.id, v.patch) }),
  })

  const deleteColumn = useBoardMutation<{ id: string; moveTo: string }>(projectId, {
    mutationFn: ({ id, moveTo }) => api.delete(`/columns/${id}?move_to=${moveTo}`),
    board: (b, v) => removeColumn(b, v.id, v.moveTo),
  })

  const createSubtask = useBoardMutation<{ taskId: string; title: string }, Subtask>(projectId, {
    mutationFn: ({ taskId, title }) => api.post<Subtask>(`/tasks/${taskId}/subtasks`, { title }),
    onSuccess: (subtask, v, qc, pid) => {
      const detail = qc.setQueryData<TaskDetail>(keys.task(v.taskId), (d) => d && { ...d, subtasks: [...d.subtasks, subtask] })
      if (detail) qc.setQueryData<Board>(keys.board(pid), (b) => b && mapTask(b, v.taskId, (t) => withSubtasks(t, detail.subtasks)))
    },
    taskId: (v) => v.taskId,
  })

  const updateSubtask = useBoardMutation<{ taskId: string; id: string; patch: UpdateSubtask }, Subtask>(projectId, {
    mutationFn: ({ id, patch }) => api.patch<Subtask>(`/subtasks/${id}`, patch),
    taskId: (v) => v.taskId,
    detail: (d, v) => ({
      ...d,
      subtasks: d.subtasks.map((s) => (s.id === v.id ? { ...s, title: v.patch.title ?? s.title, done: v.patch.done ?? s.done } : s)),
    }),
    syncSubtasks: true,
  })

  const deleteSubtask = useBoardMutation<{ taskId: string; id: string }>(projectId, {
    mutationFn: ({ id }) => api.delete(`/subtasks/${id}`),
    taskId: (v) => v.taskId,
    detail: (d, v) => ({ ...d, subtasks: d.subtasks.filter((s) => s.id !== v.id) }),
    syncSubtasks: true,
  })

  const createComment = useBoardMutation<{ taskId: string; body: string }, Comment>(projectId, {
    mutationFn: ({ taskId, body }) => api.post<Comment>(`/tasks/${taskId}/comments`, { body }),
    taskId: (v) => v.taskId,
    onSuccess: (comment, v, qc) =>
      qc.setQueryData<TaskDetail>(keys.task(v.taskId), (d) => d && { ...d, comments: [...d.comments, comment] }),
  })

  /** Метки у каждого проекта свои: новая появляется на доске этого проекта */
  const createTag = useBoardMutation<{ label: string }, Tag>(projectId, {
    mutationFn: ({ label }) => api.post<Tag>(`/projects/${projectId}/tags`, { label }),
    onSuccess: (tag, _v, qc, pid) => {
      qc.setQueryData<Board>(keys.board(pid), (b) => b && (b.tags.some((t) => t.id === tag.id) ? b : { ...b, tags: [...b.tags, tag] }))
      void qc.invalidateQueries({ queryKey: keys.board(pid) })
    },
  })

  // Модули и вехи лежат в том же ответе, что и доска; счётчики задач приходят от сервера после перечитывания

  const createModule = useBoardMutation<{ title: string }, Module>(projectId, {
    mutationFn: ({ title }) => api.post<Module>(`/projects/${projectId}/modules`, { title }),
    onSuccess: (module, _v, qc, pid) =>
      qc.setQueryData<Board>(keys.board(pid), (b) => b && { ...b, modules: [...b.modules.filter((m) => m.id !== module.id), module] }),
  })

  const updateModule = useBoardMutation<{ id: string; patch: UpdateModule }, Module>(projectId, {
    mutationFn: ({ id, patch }) => api.patch<Module>(`/modules/${id}`, patch),
    board: (b, v) => patchModule(b, v.id, v.patch),
  })

  const deleteModule = useBoardMutation<{ id: string }>(projectId, {
    mutationFn: ({ id }) => api.delete(`/modules/${id}`),
    board: (b, v) => removeModule(b, v.id),
  })

  const createMilestone = useBoardMutation<{ title: string; dueDate: string }, Milestone>(projectId, {
    mutationFn: ({ title, dueDate }) => api.post<Milestone>(`/projects/${projectId}/milestones`, { title, due_date: dueDate }),
    onSuccess: (milestone, _v, qc, pid) =>
      qc.setQueryData<Board>(keys.board(pid), (b) => b && { ...b, milestones: byDueDate([...b.milestones.filter((m) => m.id !== milestone.id), milestone]) }),
  })

  const updateMilestone = useBoardMutation<{ id: string; patch: UpdateMilestone }, Milestone>(projectId, {
    mutationFn: ({ id, patch }) => api.patch<Milestone>(`/milestones/${id}`, patch),
    board: (b, v) => patchMilestone(b, v.id, v.patch),
  })

  const deleteMilestone = useBoardMutation<{ id: string }>(projectId, {
    mutationFn: ({ id }) => api.delete(`/milestones/${id}`),
    board: (b, v) => removeMilestone(b, v.id),
  })

  return {
    moveTask, updateTask, createTask, deleteTask, createColumn, updateColumn, deleteColumn, createSubtask, updateSubtask, deleteSubtask, createComment, createTag,
    createModule, updateModule, deleteModule, createMilestone, updateMilestone, deleteMilestone,
  }
}

export type BoardMutations = ReturnType<typeof useBoardMutations>
