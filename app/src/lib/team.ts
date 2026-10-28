// Команда, чьи проекты, вики, библиотека файлов и поиск сейчас на экране (docs/TEAMS.md). Выбирает человек переключателем в
// боковом меню; выбор помнится на этом компьютере. Выбор делает `useCurrentTeam` (lib/useCurrentTeam.ts).

import { create } from 'zustand'
import type { Team } from './api/types'

type TeamState = { team: Team | null; setTeam: (team: Team | null) => void }

export const useTeamStore = create<TeamState>((set) => ({ team: null, setTeam: (team) => set({ team }) }))

/** Идентификатор текущей команды в компоненте */
export const useTeamId = () => useTeamStore((s) => s.team?.id ?? null)

/** Текущая команда в компоненте */
export const useCurrentTeamInfo = () => useTeamStore((s) => s.team)

/** Адрес внутри текущей команды: `teamPath('/wiki')` → `/teams/{id}/wiki` */
export function teamPath(suffix: string): string {
  const id = useTeamStore.getState().team?.id
  if (!id) throw new Error('Команда ещё не выбрана')
  return `/teams/${id}${suffix}`
}

/**
 * Какая команда должна быть текущей среди моих. Выбранная, если она ещё моя. Если команду ещё ни разу не выбирали,
 * команда запомненного проекта (так человек после обновления попадает туда, где работал), а потом первая из списка:
 * «Личное» (сервер отдаёт её первой). Если выбранной больше нет (меня убрали, её заархивировали), тоже первая.
 */
export function pickTeam(teams: Team[] | undefined, chosen: string | null, rememberedProjectTeam: string | null): Team | null {
  if (!teams) return null
  const wanted = chosen ?? rememberedProjectTeam
  return teams.find((t) => t.id === wanted) ?? teams[0] ?? null
}

/** Моя роль в команде управляющая: администратор команды (администратор сервера управляет любой) */
export const canManageTeam = (team: Team | null, serverAdmin: boolean): boolean => team?.role === 'admin' || (serverAdmin && team !== null)

/** Создавать проекты можно в команде, где я член (и администратору сервера в любой); гость не может */
export const canCreateProject = (team: Team | null): boolean => team !== null && !team.guest

/** Выйти из команды можно члену; владельцу своего «Личного» нельзя (сервер ответит 409, но пункта в меню не показываем) */
export const canLeaveTeam = (team: Team | null): boolean => team !== null && team.role !== null && !team.owner
