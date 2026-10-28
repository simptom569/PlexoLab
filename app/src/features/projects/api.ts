// Действия с проектами, участниками, приглашениями и метками. Это обычные запросы, а не useMutation: окнам нужен текст
// ошибки сервера на месте («Аккаунта с таким адресом нет»), а не общая плашка «Не удалось сохранить». Свои события сервер
// нашему окну не присылает (метка клиента), поэтому данные перечитываем здесь сами.

import { api } from '../../lib/api/client'
import { keys } from '../../lib/api/queries'
import type { CreateProject, Project, Tag, UpdateProject, VisibilityImpact } from '../../lib/api/types'
import type { Visibility } from '../../lib/team-dialogs'
import { queryClient } from '../../lib/query'
import type { ProjectRole } from '../../lib/project-dialogs'

/** Текст ошибки для человека: у ApiError и NetworkError он уже написан по-русски */
export const errorText = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'Не удалось выполнить')

const refresh = (...queryKeys: ReadonlyArray<readonly unknown[]>) =>
  Promise.all(queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))

export async function createProject(body: CreateProject): Promise<Project> {
  const project = await api.post<Project>('/projects', body)
  await refresh(keys.projects)
  return project
}

export async function updateProject(id: string, patch: UpdateProject): Promise<Project> {
  const project = await api.patch<Project>(`/projects/${id}`, patch)
  await refresh(keys.projects, keys.board(id))
  return project
}

/** Видимость проекта: действует сразу; число затронутых людей заранее даёт `projectVisibilityImpact` */
export async function setVisibility(id: string, visibility: Visibility): Promise<void> {
  await api.patch(`/projects/${id}`, { visibility })
  await refresh(keys.projects, keys.board(id), keys.members(id))
}

/** Сколько человек затронет смена видимости (для окна подтверждения) */
export function projectVisibilityImpact(id: string, to: Visibility): Promise<VisibilityImpact> {
  return api.get<VisibilityImpact>(`/projects/${id}/visibility-impact?to=${to}`)
}

export async function setArchived(id: string, archived: boolean): Promise<void> {
  await api.post(`/projects/${id}/${archived ? 'archive' : 'unarchive'}`, {})
  await refresh(keys.projects)
}

export async function inviteMember(projectId: string, email: string, role: ProjectRole): Promise<void> {
  await api.post(`/projects/${projectId}/invites`, { email, role })
  await refresh(keys.members(projectId))
}

export async function revokeInvite(projectId: string, inviteId: string): Promise<void> {
  await api.delete(`/invites/${inviteId}`)
  await refresh(keys.members(projectId))
}

export async function setMemberRole(projectId: string, userId: string, role: ProjectRole): Promise<void> {
  await api.patch(`/projects/${projectId}/members/${userId}`, { role })
  await refresh(keys.members(projectId), keys.projects)
}

/** Убрать участника или выйти самому: для сервера это одно и то же */
export async function removeMember(projectId: string, userId: string): Promise<void> {
  await api.delete(`/projects/${projectId}/members/${userId}`)
  await refresh(keys.members(projectId), keys.projects)
}

export async function answerInvite(inviteId: string, accept: boolean): Promise<void> {
  await api.post(`/invites/${inviteId}/${accept ? 'accept' : 'decline'}`, {})
  await refresh(keys.invites, keys.projects)
}

/** Ключ задач модуля (`null` убирает). Сервер переносит задачи между рядами, поэтому перечитываются доска и открытые задачи. */
export async function setModuleKey(projectId: string, moduleId: string, key: string | null): Promise<void> {
  await api.patch(`/modules/${moduleId}`, { key })
  await refresh(keys.board(projectId), ['task'])
}

export async function createTag(projectId: string, label: string): Promise<Tag> {
  const tag = await api.post<Tag>(`/projects/${projectId}/tags`, { label })
  await refresh(keys.board(projectId))
  return tag
}

export async function updateTag(projectId: string, id: string, patch: { label?: string; tone?: number }): Promise<Tag> {
  const tag = await api.patch<Tag>(`/tags/${id}`, patch)
  await refresh(keys.board(projectId))
  return tag
}

export async function deleteTag(projectId: string, id: string): Promise<void> {
  await api.delete(`/tags/${id}`)
  // метка сошла с задач: перечитываем и доску, и открытые задачи
  await refresh(keys.board(projectId), ['task'])
}
