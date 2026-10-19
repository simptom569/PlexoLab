// Изменения релизов и чек-листа. Правки, отметки и удаления показываются на экране сразу (оптимистично) и откатываются,
// если сервер отказал. Создание ждёт ответа: идентификаторы и порядок шагов выдаёт сервер.

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api/client'
import { keys } from '../../lib/api/queries'
import type { Release, ReleaseItem, UpdateRelease, UpdateReleaseItem } from '../../lib/api/types'
import { addItem, byDateDesc, patchItem, patchRelease, removeItem, removeRelease } from './cache'

interface Spec<V, R> {
  mutationFn: (vars: V) => Promise<R>
  /** Что изменить в списке до ответа сервера */
  apply?: (list: Release[], vars: V) => Release[]
  /** Ответ сервера → кэш (для того, что нельзя показать до ответа) */
  onSuccess?: (data: R, vars: V, qc: QueryClient, projectId: string) => void
}

function useReleaseMutation<V, R = void>(projectId: string, spec: Spec<V, R>) {
  const qc = useQueryClient()
  const key = keys.releases(projectId)
  const mutationKey = ['release-edit', projectId]

  return useMutation<R, Error, V, { before?: Release[] }>({
    mutationKey,
    mutationFn: spec.mutationFn,
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key })
      const before = qc.getQueryData<Release[]>(key)
      if (before && spec.apply) qc.setQueryData(key, spec.apply(before, vars))
      return { before }
    },
    onError: (_error, _vars, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before)
    },
    onSuccess: (data, vars) => spec.onSuccess?.(data, vars, qc, projectId),
    onSettled: () => {
      // пока идут другие правки, список не перечитываем: иначе он «мигнёт» старыми данными
      if (qc.isMutating({ mutationKey }) > 1) return
      void qc.invalidateQueries({ queryKey: key })
    },
  })
}

export function useReleaseMutations(projectId: string) {
  const createRelease = useReleaseMutation<{ version: string; date: string }, Release>(projectId, {
    mutationFn: ({ version, date }) => api.post<Release>(`/projects/${projectId}/releases`, { version, release_date: date }),
    onSuccess: (release, _v, qc, pid) =>
      qc.setQueryData<Release[]>(keys.releases(pid), (list) => list && byDateDesc([...list.filter((r) => r.id !== release.id), release])),
  })

  const updateRelease = useReleaseMutation<{ id: string; patch: UpdateRelease }, Release>(projectId, {
    mutationFn: ({ id, patch }) => api.patch<Release>(`/releases/${id}`, patch),
    apply: (list, v) => patchRelease(list, v.id, v.patch),
  })

  const deleteRelease = useReleaseMutation<{ id: string }>(projectId, {
    mutationFn: ({ id }) => api.delete(`/releases/${id}`),
    apply: (list, v) => removeRelease(list, v.id),
  })

  const createItem = useReleaseMutation<{ releaseId: string; title: string }, ReleaseItem>(projectId, {
    mutationFn: ({ releaseId, title }) => api.post<ReleaseItem>(`/releases/${releaseId}/items`, { title }),
    onSuccess: (item, v, qc, pid) => qc.setQueryData<Release[]>(keys.releases(pid), (list) => list && addItem(list, v.releaseId, item)),
  })

  const updateItem = useReleaseMutation<{ releaseId: string; id: string; patch: UpdateReleaseItem }, ReleaseItem>(projectId, {
    mutationFn: ({ id, patch }) => api.patch<ReleaseItem>(`/release-items/${id}`, patch),
    apply: (list, v) => patchItem(list, v.releaseId, v.id, v.patch),
  })

  const deleteItem = useReleaseMutation<{ releaseId: string; id: string }>(projectId, {
    mutationFn: ({ id }) => api.delete(`/release-items/${id}`),
    apply: (list, v) => removeItem(list, v.releaseId, v.id),
  })

  return { createRelease, updateRelease, deleteRelease, createItem, updateItem, deleteItem }
}

export type ReleaseMutations = ReturnType<typeof useReleaseMutations>
