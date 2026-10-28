// Команда, чьи вики, библиотека файлов и поиск сейчас на экране (docs/TEAMS.md). Переключатель команд появится на этапе К3;
// пока это команда открытого проекта, а если вики её не читать (человек там гость) или проектов нет, первая из команд
// с доступной вики, то есть «Личное». Выбор делает `useCurrentTeam` (lib/useCurrentTeam.ts).

import { create } from 'zustand'
import type { Team } from './api/types'

type TeamState = { teamId: string | null; setTeam: (id: string | null) => void }

export const useTeamStore = create<TeamState>((set) => ({ teamId: null, setTeam: (teamId) => set({ teamId }) }))

/** Текущая команда в компоненте */
export const useTeamId = () => useTeamStore((s) => s.teamId)

/** Адрес внутри текущей команды: `teamPath('/wiki')` → `/teams/{id}/wiki` */
export function teamPath(suffix: string): string {
  const id = useTeamStore.getState().teamId
  if (!id) throw new Error('Команда ещё не выбрана')
  return `/teams/${id}${suffix}`
}

/** Какая команда должна быть текущей: команда проекта, если её вики читать можно, иначе первая из доступных */
export function pickTeam(teams: Team[] | undefined, projectTeamId: string | null | undefined): string | null {
  if (!teams) return null
  return teams.find((t) => t.id === projectTeamId && t.wiki)?.id ?? teams.find((t) => t.wiki)?.id ?? null
}

/** Команда для нового проекта: текущая, если я в ней член, иначе первая, где я член («Личное») */
export function teamForNewProject(teams: Team[] | undefined, currentId: string | null): string | null {
  if (!teams) return null
  return teams.find((t) => t.id === currentId && t.role)?.id ?? teams.find((t) => t.role)?.id ?? null
}
