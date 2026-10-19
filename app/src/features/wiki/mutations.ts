// Изменения вики и файлов. Создание ждёт сервера (идентификаторы выдаёт он), удаления показываются сразу
// и откатываются, если сервер отказал.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { api } from '../../lib/api/client'
import { keys } from '../../lib/api/queries'
import type { FileList, Folder, LibraryFile, WikiNode, WikiPage } from '../../lib/api/types'
import { dropDrafts, toNode } from './drafts'
import { uploadInBatches } from '../../lib/upload'
import { useWikiStore } from './store'

// ----- Страницы -----

/** Новая страница: создаётся, открывается и ждёт ввода (createWiki в макете) */
export function useCreatePage() {
  const qc = useQueryClient()
  return useMutation<WikiPage, Error, { parentId: string | null; title: string }>({
    mutationFn: ({ parentId, title }) => api.post<WikiPage>('/wiki', { parent_id: parentId, title }),
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

/** Страница и все вложенные в неё */
export function subtreeIds(pages: WikiNode[], id: string): Set<string> {
  const ids = new Set([id])
  for (let grew = true; grew; ) {
    grew = false
    for (const p of pages) {
      if (p.parent_id && ids.has(p.parent_id) && !ids.has(p.id)) {
        ids.add(p.id)
        grew = true
      }
    }
  }
  return ids
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
      uploadInBatches<LibraryFile>('/files', files, { folder_id: folderId, wiki_page_id: wikiPageId }),
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
    mutationFn: ({ name }) => api.post<Folder>('/folders', { name }),
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
