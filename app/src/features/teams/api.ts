// Действия с командами, их составом и приглашениями. Как и в features/projects/api.ts, это обычные запросы, а не useMutation:
// окнам нужен текст ошибки сервера на месте («Аккаунта с таким адресом нет», «Вы единственный администратор…»), а не общая
// плашка. Свои события сервер нашему окну не присылает (метка клиента), поэтому данные перечитываем здесь сами.

import { api } from '../../lib/api/client'
import { keys } from '../../lib/api/queries'
import type { Team } from '../../lib/api/types'
import { queryClient } from '../../lib/query'
import type { ProjectRole } from '../../lib/project-dialogs'

export { errorText } from '../projects/api'

const refresh = (...queryKeys: ReadonlyArray<readonly unknown[]>) =>
  Promise.all(queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))

export async function createTeam(name: string): Promise<Team> {
  const team = await api.post<Team>('/teams', { name })
  await refresh(keys.teams)
  return team
}

export async function updateTeam(id: string, patch: { name?: string; guests_read_wiki?: boolean }): Promise<Team> {
  const team = await api.patch<Team>(`/teams/${id}`, patch)
  await refresh(keys.teams)
  return team
}

export async function archiveTeam(id: string): Promise<void> {
  await api.post(`/teams/${id}/archive`, {})
  await refresh(keys.teams, keys.projects)
}

export async function restoreTeam(id: string): Promise<void> {
  await api.post(`/teams/${id}/restore`, {})
  await refresh(keys.teams, keys.projects)
}

export async function setTeamMemberRole(teamId: string, userId: string, role: ProjectRole): Promise<void> {
  await api.patch(`/teams/${teamId}/members/${userId}`, { role })
  await refresh(keys.teamMembers(teamId), keys.teams, keys.projects)
}

/** Убрать члена команды (администратор); он уходит и из явных участий в её проектах */
export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  await api.delete(`/teams/${teamId}/members/${userId}`)
  await refresh(keys.teamMembers(teamId), keys.projects)
}

export async function leaveTeam(teamId: string): Promise<void> {
  await api.post(`/teams/${teamId}/leave`, {})
  await refresh(keys.teams, keys.projects)
}

export async function inviteToTeam(teamId: string, email: string, role: ProjectRole): Promise<void> {
  await api.post(`/teams/${teamId}/invites`, { email, role })
  await refresh(keys.teamMembers(teamId))
}

export async function revokeTeamInvite(teamId: string, inviteId: string): Promise<void> {
  await api.delete(`/team-invites/${inviteId}`)
  await refresh(keys.teamMembers(teamId))
}

export async function answerTeamInvite(inviteId: string, accept: boolean): Promise<void> {
  await api.post(`/team-invites/${inviteId}/${accept ? 'accept' : 'decline'}`, {})
  await refresh(keys.teamInvites, keys.teams, keys.projects)
}
