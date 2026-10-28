import { useEffect } from 'react'
import { keys } from './api/queries'
import type { Team } from './api/types'
import { queryClient } from './query'
import { pickTeam, useTeamStore } from './team'

/** Данные команды, которая перестала быть текущей, на экране не нужны */
const PER_TEAM_KEYS = [keys.wiki, ['wiki-page'], keys.files, keys.folders, ['search']] as const

/** Следит за выбором команды: записывает её в хранилище и сбрасывает данные прежней */
export function useCurrentTeam(teams: Team[] | undefined, projectTeamId: string | null | undefined): void {
  const teamId = pickTeam(teams, projectTeamId)
  useEffect(() => {
    if (useTeamStore.getState().teamId === teamId) return
    useTeamStore.getState().setTeam(teamId)
    for (const queryKey of PER_TEAM_KEYS) queryClient.removeQueries({ queryKey })
  }, [teamId])
}
