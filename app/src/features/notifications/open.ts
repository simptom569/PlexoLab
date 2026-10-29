// Открыть задачу из уведомления: из списка «Уведомления» и по нажатию на окошко Windows.

import type { Project } from '../../lib/api/types'
import { useTeamStore } from '../../lib/team'
import { useUi } from '../../lib/ui-store'

/** Задача на доске её проекта, с открытой панелью. Закрывает окно уведомлений, если оно было открыто. */
export function openNotificationTask(target: { project_id: string; task_id: string }, projects: Project[] | undefined): void {
  // сначала проект и экран (они сбрасывают открытую задачу), потом сама задача
  const ui = useUi.getState()
  // уведомление из другой команды: сначала переходим в неё (docs/TEAMS.md, 7)
  const team = projects?.find((p) => p.id === target.project_id)?.team_id
  if (team && team !== useTeamStore.getState().team?.id) ui.setTeam(team)
  ui.setProject(target.project_id)
  ui.setPage('board')
  ui.openTask(target.task_id)
  ui.closeProjectDialog()
}
