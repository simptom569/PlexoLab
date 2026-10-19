// Вложения задачи: загрузка и удаление в панели задачи. Файлы лежат в ответе `GET /tasks/{id}`, поэтому
// кэш панели правится здесь же. Загрузка ждёт сервера, удаление показывается сразу и откатывается при отказе.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api/client'
import { keys } from '../../lib/api/queries'
import type { TaskDetail, TaskFile } from '../../lib/api/types'
import { uploadInBatches } from '../../lib/upload'

export function useTaskFiles(taskId: string) {
  const qc = useQueryClient()
  const key = keys.task(taskId)

  const upload = useMutation<TaskFile[], Error, File[]>({
    mutationFn: (files) => uploadInBatches<TaskFile>(`/tasks/${taskId}/files`, files),
    onSuccess: (uploaded) =>
      qc.setQueryData<TaskDetail>(key, (task) => task && { ...task, files: [...task.files, ...uploaded.filter((f) => !task.files.some((x) => x.id === f.id))] }),
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  })

  const remove = useMutation<void, Error, { id: string }, { before?: TaskDetail }>({
    mutationFn: ({ id }) => api.delete(`/files/${id}`),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: key })
      const before = qc.getQueryData<TaskDetail>(key)
      if (before) qc.setQueryData<TaskDetail>(key, { ...before, files: before.files.filter((f) => f.id !== id) })
      return { before }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before)
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  })

  return { upload, remove }
}
