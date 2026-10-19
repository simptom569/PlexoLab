// Изменения документов. Создание ждёт сервера (идентификатор выдаёт он), остальное показывается на экране сразу
// и откатывается, если сервер отказал (плашку об ошибке показывает MutationCache, см. lib/query.ts).

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { api } from '../../lib/api/client'
import { keys } from '../../lib/api/queries'
import type { Doc, DocMode, DocSummary } from '../../lib/api/types'
import { dropDocDrafts } from './drafts'
import { moveDoc, sortLike } from './logic'
import { useDocsStore } from './store'

type ListSnapshot = Array<[readonly unknown[], DocSummary[] | undefined]>

/** Все кэшированные списки (полный и результаты поиска) до изменения: чтобы вернуть их при отказе сервера */
async function takeLists(qc: QueryClient): Promise<ListSnapshot> {
  await qc.cancelQueries({ queryKey: keys.docs })
  return qc.getQueriesData<DocSummary[]>({ queryKey: keys.docs })
}

const restoreLists = (qc: QueryClient, lists?: ListSnapshot) => {
  for (const [key, data] of lists ?? []) qc.setQueryData(key, data)
}

const mapLists = (qc: QueryClient, fn: (list: DocSummary[]) => DocSummary[]) =>
  qc.setQueriesData<DocSummary[]>({ queryKey: keys.docs }, (list) => list && fn(list))

const patchSummary = (qc: QueryClient, id: string, patch: Partial<DocSummary>) =>
  mapLists(qc, (list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)))

const patchDoc = (qc: QueryClient, id: string, patch: Partial<Doc>) =>
  qc.setQueryData<Doc>(keys.doc(id), (d) => d && { ...d, ...patch })

/** Новый документ: создаётся, открывается и ждёт ввода (createDoc в макете) */
export function useCreateDoc() {
  const qc = useQueryClient()
  return useMutation<Doc, Error, { mode: DocMode }>({
    mutationFn: ({ mode }) => api.post<Doc>('/docs', { mode }),
    onSuccess: (doc) => {
      qc.setQueryData(keys.doc(doc.id), doc)
      void qc.invalidateQueries({ queryKey: keys.docs })
      useDocsStore.getState().created(doc.id)
    },
  })
}

/**
 * То же, но пока документ создаётся, повторные нажатия игнорируются. Состояние мутации обновляется только после
 * отрисовки, а два быстрых нажатия приходят раньше, поэтому защита держится на ссылке.
 */
export function useCreateDocOnce() {
  const create = useCreateDoc()
  const busy = useRef(false)
  return (mode: DocMode) => {
    if (busy.current) return
    busy.current = true
    create.mutate({ mode }, { onSettled: () => void (busy.current = false) })
  }
}

export function useDeleteDoc() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }, { lists: ListSnapshot }>({
    mutationFn: ({ id }) => api.delete(`/docs/${id}`),
    onMutate: async ({ id }) => {
      const lists = await takeLists(qc)
      // документ уходит сразу; его несохранённые правки уже никому не нужны
      dropDocDrafts([id])
      mapLists(qc, (list) => list.filter((d) => d.id !== id))
      useDocsStore.getState().closeDoc()
      return { lists }
    },
    onError: (_e, _v, ctx) => restoreLists(qc, ctx?.lists),
    onSettled: (_d, _e, { id }) => {
      qc.removeQueries({ queryKey: keys.doc(id) })
      void qc.invalidateQueries({ queryKey: keys.docs })
    },
  })
}

/** Своя звёздочка: в списке и в открытом документе сразу, на сервере по ответу */
export function useStarDoc() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string; starred: boolean }, { lists: ListSnapshot; doc?: Doc }>({
    mutationFn: ({ id, starred }) => api.put(`/docs/${id}/star`, { starred }),
    onMutate: async ({ id, starred }) => {
      const lists = await takeLists(qc)
      await qc.cancelQueries({ queryKey: keys.doc(id) })
      const doc = qc.getQueryData<Doc>(keys.doc(id))
      patchSummary(qc, id, { starred })
      patchDoc(qc, id, { starred })
      return { lists, doc }
    },
    onError: (_e, { id }, ctx) => {
      restoreLists(qc, ctx?.lists)
      if (ctx?.doc) qc.setQueryData(keys.doc(id), ctx.doc)
    },
    onSettled: (_d, _e, { id }) => {
      void qc.invalidateQueries({ queryKey: keys.docs })
      void qc.invalidateQueries({ queryKey: keys.doc(id) })
    },
  })
}

/** «Страница / Холст»: это вид, версию текста не меняет, поэтому конфликта с сохранением текста не бывает */
export function useSetDocMode() {
  const qc = useQueryClient()
  return useMutation<Doc, Error, { id: string; mode: DocMode }, { lists: ListSnapshot; mode?: DocMode }>({
    mutationFn: ({ id, mode }) => api.patch<Doc>(`/docs/${id}`, { mode }),
    onMutate: async ({ id, mode }) => {
      const lists = await takeLists(qc)
      await qc.cancelQueries({ queryKey: keys.doc(id) })
      const prev = qc.getQueryData<Doc>(keys.doc(id))?.mode
      patchSummary(qc, id, { mode })
      patchDoc(qc, id, { mode })
      return { lists, mode: prev }
    },
    onError: (_e, { id }, ctx) => {
      restoreLists(qc, ctx?.lists)
      if (ctx?.mode) patchDoc(qc, id, { mode: ctx.mode })
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.docs }),
  })
}

/**
 * Перенос карточки: документ перед `beforeId` (null — в конец). На экране сразу, при отказе сервера возвращается.
 * Порядок общий для команды, на сервере его меняет `PATCH /docs/{id}` без проверки версии текста.
 */
export function useMoveDoc() {
  const qc = useQueryClient()
  const mutationKey = ['docs-move']
  return useMutation<Doc, Error, { id: string; beforeId: string | null }, { lists: ListSnapshot }>({
    mutationKey,
    mutationFn: ({ id, beforeId }) => api.patch<Doc>(`/docs/${id}`, { before_id: beforeId }),
    onMutate: async ({ id, beforeId }) => {
      const lists = await takeLists(qc)
      // новый общий порядок считается по полному списку; поиск и «Избранные» показывают его часть
      const full = qc.getQueryData<DocSummary[]>(keys.docs)
      const order = full ? moveDoc(full, id, beforeId).map((d) => d.id) : null
      mapLists(qc, (list) => (order ? sortLike(list, order) : moveDoc(list, id, beforeId)))
      return { lists }
    },
    onError: (_e, _v, ctx) => restoreLists(qc, ctx?.lists),
    onSettled: () => {
      // пока идут другие переносы, список не перечитываем: иначе он «мигнёт» старым порядком
      if (qc.isMutating({ mutationKey }) > 1) return
      void qc.invalidateQueries({ queryKey: keys.docs })
    },
  })
}
