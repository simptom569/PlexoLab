// Чтение данных с сервера через TanStack Query. Ключи собраны в одном месте, чтобы изменения (мутации)
// и события WebSocket (этап 8) обращались к тем же самым записям кэша.

import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { Board, Project, Release, TaskDetail, User } from './types'

export const keys = {
  projects: ['projects'] as const,
  users: ['users'] as const,
  board: (projectId: string) => ['board', projectId] as const,
  task: (taskId: string) => ['task', taskId] as const,
  releases: (projectId: string) => ['releases', projectId] as const,
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
