import { useEffect } from 'react'
import { keys, useTeamInfo, useTeams } from './api/queries'
import type { Project, Team } from './api/types'
import { queryClient } from './query'
import { pickTeam, useTeamStore } from './team'
import { useUi } from './ui-store'

/** Данные команды, которая перестала быть текущей, на экране не нужны */
const PER_TEAM_KEYS = [keys.wiki, ['wiki-page'], keys.files, keys.folders, ['search']] as const

/**
 * Какая команда сейчас на экране (docs/TEAMS.md, 11.1): выбранная в переключателе, если она ещё моя, иначе «Личное». Администратор
 * сервера может открыть и чужую (окно «Все команды сервера»): её сервер отдаёт отдельным запросом. Результат записывается в
 * хранилище (`lib/team.ts`) для запросов вики, файлов и поиска; при смене команды данные прежней сбрасываются, а выбор
 * исправляется в настройках, если он устарел.
 *
 * Пока человек не выбирал команду (первый запуск после обновления), берётся команда запомненного проекта: так он попадает туда,
 * где работал; а если проекта нет, «Личное».
 *
 * `projects`: мои проекты, нужны только для запомненного проекта.
 */
export function useCurrentTeam(projects: Project[] | undefined): { team: Team | null; teams: Team[]; ready: boolean } {
  const teams = useTeams()
  const chosen = useUi((s) => s.team)
  const rememberedProject = useUi((s) => s.project)
  const list = teams.data

  const mine = list?.some((t) => t.id === chosen) ?? false
  // выбрана не моя команда: её открыл администратор сервера, и найти её можно только отдельным запросом
  const outsideId = chosen !== null && list !== undefined && !mine ? chosen : null
  const outside = useTeamInfo(outsideId)

  const remembered = chosen === null ? (projects?.find((p) => p.id === rememberedProject)?.team_id ?? null) : null
  // запомненный проект ещё не загрузился: рано выбирать, иначе человек на миг увидел бы «Личное»
  const waitingForProject = chosen === null && rememberedProject !== null && projects === undefined
  const waitingForOutside = outsideId !== null && outside.isPending
  const ready = list !== undefined && !waitingForProject && !waitingForOutside

  let team: Team | null = null
  if (ready) team = outsideId !== null && outside.data ? outside.data : pickTeam(list, outsideId !== null ? null : chosen, remembered)

  useEffect(() => {
    const previous = useTeamStore.getState().team
    if (previous === team) return
    useTeamStore.getState().setTeam(team)
    if (previous?.id !== team?.id) for (const queryKey of PER_TEAM_KEYS) queryClient.removeQueries({ queryKey })
    // выбор устарел (меня убрали, команду заархивировали) или его ещё не было: записываем то, что на экране
    if (team && team.id !== useUi.getState().team) useUi.setState({ team: team.id })
  }, [team])

  return { team, teams: list ?? [], ready }
}
