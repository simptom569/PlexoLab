import { useEffect } from 'react'
import { Avatar } from '../../components'
import { useTeamMembers } from '../../lib/api/queries'
import { ROLE_LABELS, roleOf } from '../../lib/project-dialogs'
import type { ProjectDialog } from '../../lib/project-dialogs'
import { useSession } from '../../lib/session'
import { useCurrentTeamInfo } from '../../lib/team'
import { useUi } from '../../lib/ui-store'
import { DialogFrame, Problem } from '../projects/parts'

/** «Участники» команды для рядового члена: только список (управляет составом администратор в «Настройках команды») */
export function TeamMembersDialog({ dialog }: { dialog: Extract<ProjectDialog, { kind: 'team-members' }> }) {
  const close = useUi((s) => s.closeProjectDialog)
  const me = useSession((s) => s.user)
  const team = useCurrentTeamInfo()
  const members = useTeamMembers(dialog.id)

  // команда сменилась или я уже не её член: окно закрывается
  const gone = !team || team.id !== dialog.id
  useEffect(() => {
    if (gone) close()
  }, [gone, close])

  return (
    <DialogFrame title={team ? `Участники: ${team.name}` : 'Участники'} narrow onClose={close}>
      {members.isPending ? (
        <div className="empty">Загружаю…</div>
      ) : !members.data ? (
        <Problem>Не удалось загрузить участников</Problem>
      ) : (
        <div className="proj-rows" aria-label="Участники команды">
          {members.data.members.map((m) => (
            <div className="proj-row" key={m.user_id}>
              <div className="proj-person">
                <Avatar name={m.name} tone={m.tone} decorative />
                <span>
                  <strong>
                    {m.name}
                    {m.user_id === me?.id ? ' (вы)' : ''}
                  </strong>
                  <small>{m.job}</small>
                </span>
              </div>
              <span className="set-desc" style={{ margin: 0 }}>
                {ROLE_LABELS[roleOf(m.role)]}
              </span>
            </div>
          ))}
        </div>
      )}
    </DialogFrame>
  )
}
