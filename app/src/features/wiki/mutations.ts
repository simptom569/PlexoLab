// Изменения вики и файлов. Создание ждёт сервера (идентификаторы выдаёт он), удаления показываются сразу
// и откатываются, если сервер отказал.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { api } from '../../lib/api/client'
import { keys } from '../../lib/api/queries'
import { teamPath } from '../../lib/team'
import type { FileList, Folder, LibraryFile, WikiNode, WikiPage } from '../../lib/api/types'
import { dropDrafts, toNode } from './drafts'
import { uploadInBatches } from '../../lib/upload'
import { moveInList, subtreeIds } from './logic'
import { useWikiStore } from './store'

// ----- Страницы -----

/** Новая страница: создаётся, открывается и ждёт ввода (createWiki в макете) */
export function useCreatePage() {
  const qc = useQueryClient()
  return useMutation<WikiPage, Error, { parentId: string | null; title: string }>({
    mutationFn: ({ parentId, title }) => api.post<WikiPage>(teamPath('/wiki'), { parent_id: parentId, title }),
    onSuccess: (page, { parentId }) => {
      qc.setQueryData(keys.wikiPage(page.id), page)
      qc.setQueryData<WikiNode[]>(keys.wiki, (list) => [...(list ?? []).filter((n) => n.id !== page.id), toNode(page)])
      useWikiStore.getState().created(page.id, parentId)
    },
  })
}

/**
 * То же, но пока страница создаётся, повторные нажатия игнорируются. Состояние мутации обновляется только после
 * отрисовки, а два быстрых нажатия приходят раньше, поэтому защита держится на ссылке.
 */
export function useCreatePageOnce() {
  const create = useCreatePage()
  const busy = useRef(false)
  return (parentId: string | null, title: string, onSuccess?: () => void) => {
    if (busy.current) return
    busy.current = true
    create.mutate({ parentId, title }, { onSuccess, onSettled: () => void (busy.current = false) })
  }
}

/**
 * Перенос страницы по дереву: на экране сразу, при отказе сервера возвращается. Сервер версию страницы не трогает,
 * поэтому перенос открытой и редактируемой страницы не мешает её сохранению.
 */
export function useMovePage() {
  const qc = useQueryClient()
  const mutationKey = ['wiki-move']
  return useMutation<WikiPage, Error, { id: string; parentId: string | null; beforeId: string | null }, { before?: WikiNode[] }>({
    mutationKey,
    mutationFn: ({ id, parentId, beforeId }) => api.patch<WikiPage>(`/wiki/${id}`, { parent_id: parentId, before_id: beforeId }),
    onMutate: async ({ id, parentId, beforeId }) => {
      await qc.cancelQueries({ queryKey: keys.wiki })
      const before = qc.getQueryData<WikiNode[]>(keys.wiki)
      if (before) qc.setQueryData<WikiNode[]>(keys.wiki, moveInList(before, id, parentId, beforeId))
      // куда бы страница ни попала, её должно быть видно
      if (parentId) useWikiStore.getState().reveal([parentId])
      return { before }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(keys.wiki, ctx.before)
    },
    onSettled: () => {
      // пока идут другие переносы, дерево не перечитываем: иначе оно «мигнёт» старым порядком
      if (qc.isMutating({ mutationKey }) > 1) return
      void qc.invalidateQueries({ queryKey: keys.wiki })
    },
  })
}

export function useDeletePage() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }, { before?: WikiNode[] }>({
    mutationFn: ({ id }) => api.delete(`/wiki/${id}`),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: keys.wiki })
      const before = qc.getQueryData<WikiNode[]>(keys.wiki)
      if (before) {
        const gone = subtreeIds(before, id)
        // страница уходит из дерева сразу; её несохранённые правки уже никому не нужны
        dropDrafts(gone)
        qc.setQueryData<WikiNode[]>(
          keys.wiki,
          before.filter((n) => !gone.has(n.id)),
        )
      }
      return { before }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(keys.wiki, ctx.before)
    },
    onSettled: () => {
      // файлы удалённых страниц остались в библиотеке, но уже без страницы
      for (const key of [keys.wiki, keys.files, keys.folders]) void qc.invalidateQueries({ queryKey: key })
    },
  })
}

// ----- Файлы -----

/** Загрузка файлов в библиотеку (в папку или на страницу). Много файлов уходят несколькими запросами. */
export function useUploadFiles() {
  const qc = useQueryClient()
  return useMutation<LibraryFile[], Error, { files: File[]; folderId?: string | null; wikiPageId?: string | null }>({
    mutationFn: ({ files, folderId, wikiPageId }) =>
      uploadInBatches<LibraryFile>(teamPath('/files'), files, { folder_id: folderId, wiki_page_id: wikiPageId }),
    onSettled: () => {
      // порядок и папка «Вложения» (её сервер создаёт сам) известны только серверу
      for (const key of [keys.files, keys.folders]) void qc.invalidateQueries({ queryKey: key })
    },
  })
}

export function useDeleteFile() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }, { before?: FileList }>({
    mutationFn: ({ id }) => api.delete(`/files/${id}`),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: keys.files })
      const before = qc.getQueryData<FileList>(keys.files)
      if (before) qc.setQueryData<FileList>(keys.files, { total: before.total - 1, files: before.files.filter((f) => f.id !== id) })
      return { before }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(keys.files, ctx.before)
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.files }),
  })
}

// ----- Папки -----

export function useCreateFolder() {
  const qc = useQueryClient()
  return useMutation<Folder, Error, { name: string }>({
    mutationFn: ({ name }) => api.post<Folder>(teamPath('/folders'), { name }),
    onSuccess: (folder) => qc.setQueryData<Folder[]>(keys.folders, (list) => [...(list ?? []), folder]),
    // такую папку успел создать кто-то другой: список обновится
    onError: () => void qc.invalidateQueries({ queryKey: keys.folders }),
  })
}

export function useDeleteFolder() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }, { before?: Folder[] }>({
    mutationFn: ({ id }) => api.delete(`/folders/${id}`),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: keys.folders })
      const before = qc.getQueryData<Folder[]>(keys.folders)
      if (before)
        qc.setQueryData<Folder[]>(
          keys.folders,
          before.filter((f) => f.id !== id),
        )
      return { before }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(keys.folders, ctx.before)
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.folders }),
  })
}
