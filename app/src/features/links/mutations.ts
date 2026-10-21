// Изменения групп ссылок и самих ссылок. Переименование и удаление показываются на экране сразу (оптимистично) и
// откатываются, если сервер отказал. Создание ждёт ответа: идентификаторы выдаёт сервер.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api/client'
import { keys } from '../../lib/api/queries'
import type { LinkGroup, LinkItem } from '../../lib/api/types'
import { addGroup, addLink, removeGroup, removeLink, renameGroup } from './logic'

interface Spec<V, R> {
  mutationFn: (vars: V) => Promise<R>
  /** Что изменить в списке до ответа сервера */
  apply?: (list: LinkGroup[], vars: V) => LinkGroup[]
  /** Ответ сервера → список (для того, что нельзя показать до ответа) */
  merge?: (list: LinkGroup[], data: R, vars: V) => LinkGroup[]
}

function useLinkMutation<V, R = void>(projectId: string, spec: Spec<V, R>) {
  const qc = useQueryClient()
  const key = keys.projectLinkGroups(projectId)
  const mutationKey = ['link-edit']

  return useMutation<R, Error, V, { before?: LinkGroup[] }>({
    mutationKey,
    mutationFn: spec.mutationFn,
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key })
      const before = qc.getQueryData<LinkGroup[]>(key)
      if (before && spec.apply) qc.setQueryData(key, spec.apply(before, vars))
      return { before }
    },
    onError: (_error, _vars, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before)
    },
    onSuccess: (data, vars) => {
      const { merge } = spec
      if (merge) qc.setQueryData<LinkGroup[]>(key, (list) => list && merge(list, data, vars))
    },
    onSettled: () => {
      // пока идут другие правки, список не перечитываем: иначе он «мигнёт» старыми данными
      if (qc.isMutating({ mutationKey }) > 1) return
      void qc.invalidateQueries({ queryKey: key })
    },
  })
}

export function useLinkMutations(projectId: string) {
  const createGroup = useLinkMutation<{ title: string }, LinkGroup>(projectId, {
    mutationFn: ({ title }) => api.post<LinkGroup>(`/projects/${projectId}/link-groups`, { title }),
    merge: (list, group) => addGroup(list, group),
  })

  const renameGroupTitle = useLinkMutation<{ id: string; title: string }, LinkGroup>(projectId, {
    mutationFn: ({ id, title }) => api.patch<LinkGroup>(`/link-groups/${id}`, { title }),
    apply: (list, v) => renameGroup(list, v.id, v.title),
  })

  const deleteGroup = useLinkMutation<{ id: string }>(projectId, {
    mutationFn: ({ id }) => api.delete(`/link-groups/${id}`),
    apply: (list, v) => removeGroup(list, v.id),
  })

  const createLink = useLinkMutation<{ groupId: string; title: string; url: string }, LinkItem>(projectId, {
    mutationFn: ({ groupId, title, url }) => api.post<LinkItem>(`/link-groups/${groupId}/links`, { title, url }),
    merge: (list, link) => addLink(list, link),
  })

  const deleteLink = useLinkMutation<{ id: string }>(projectId, {
    mutationFn: ({ id }) => api.delete(`/links/${id}`),
    apply: (list, v) => removeLink(list, v.id),
  })

  return { createGroup, renameGroup: renameGroupTitle, deleteGroup, createLink, deleteLink }
}

export type LinkMutations = ReturnType<typeof useLinkMutations>
