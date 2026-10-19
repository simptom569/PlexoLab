// Чтение данных с сервера через TanStack Query. Ключи собраны в одном месте, чтобы изменения (мутации)
// и события WebSocket (этап 8) обращались к тем же самым записям кэша.

import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { Board, FileList, Folder, Project, Release, TaskDetail, User, WikiNode, WikiPage } from './types'

export const keys = {
  projects: ['projects'] as const,
  users: ['users'] as const,
  board: (projectId: string) => ['board', projectId] as const,
  task: (taskId: string) => ['task', taskId] as const,
  releases: (projectId: string) => ['releases', projectId] as const,
  wiki: ['wiki'] as const,
  wikiPage: (id: string) => ['wiki-page', id] as const,
  files: ['files'] as const,
  folders: ['folders'] as const,
}

export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: () => api.get<Project[]>('/projects') })

export const useUsers = () => useQuery({ queryKey: keys.users, queryFn: () => api.get<User[]>('/users'), staleTime: 60_000 })

export const useBoard = (projectId: string | null) =>
  useQuery({
    queryKey: keys.board(projectId ?? ''),
    queryFn: () => api.get<Board>(`/projects/${projectId}/board`),
    enabled: projectId !== null,
  })

export const useReleases = (projectId: string) =>
  useQuery({ queryKey: keys.releases(projectId), queryFn: () => api.get<Release[]>(`/projects/${projectId}/releases`) })

export const useTask = (taskId: string | null) =>
  useQuery({
    queryKey: keys.task(taskId ?? ''),
    queryFn: () => api.get<TaskDetail>(`/tasks/${taskId}`),
    enabled: taskId !== null,
  })

/** Дерево страниц вики без текста */
export const useWiki = () => useQuery({ queryKey: keys.wiki, queryFn: () => api.get<WikiNode[]>('/wiki') })

/** Страница с текстом. Правки идут через `usePageDraft`, который сам держит кэш страницы в порядке. */
export const useWikiPage = (id: string | null) =>
  useQuery({
    queryKey: keys.wikiPage(id ?? ''),
    queryFn: () => api.get<WikiPage>(`/wiki/${id}`),
    enabled: id !== null,
  })

/** Вся библиотека файлов сразу: поиск, тип и папки отбираются на экране, так они откликаются мгновенно */
export const useLibrary = () => useQuery({ queryKey: keys.files, queryFn: () => api.get<FileList>('/files') })

export const useFolders = () => useQuery({ queryKey: keys.folders, queryFn: () => api.get<Folder[]>('/folders') })
