import { Fragment, useState } from 'react'
import { Button, Sq } from '../../components'
import { useMyInvites, useMyTeamInvites } from '../../lib/api/queries'
import { failed } from '../../lib/query'
import { ROLE_LABELS, roleOf } from '../../lib/project-dialogs'
import { useUi } from '../../lib/ui-store'
import { answerTeamInvite } from '../teams/api'
import { answerInvite, errorText } from './api'
import { DialogFrame, Problem, RowProblem } from './parts'

/** «Приглашения»: команды и проекты, куда меня позвали и где я ещё не ответил. Принять или отклонить. */
export function InvitesDialog() {
  const close = useUi((s) => s.closeProjectDialog)
  const invites = useMyInvites()
  const teamInvites = useMyTeamInvites()
  const [busy, setBusy] = useState<string | null>(null)
  // ошибка стоит под приглашением, на которое не удалось ответить
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null)

  const answer = async (id: string, work: () => Promise<void>) => {
    setBusy(id)
    setProblem(null)
    try {
      await work()
    } catch (e) {
      setProblem({ id, text: errorText(e) })
    } finally {
      setBusy(null)
    }
  }

  const projectList = invites.data ?? []
  const teamList = teamInvites.data ?? []
  const loading = invites.isPending || teamInvites.isPending
  return (
    <DialogFrame title="Приглашения" narrow onClose={close}>
      {loading ? (
        <div className="empty">Загружаю…</div>
      ) : failed(invites) || failed(teamInvites) ? (
        <Problem>Не удалось загрузить приглашения</Problem>
      ) : projectList.length + teamList.length === 0 ? (
        <div className="empty">Приглашений нет</div>
      ) : (
        <>
          {teamList.length > 0 && (
            <section>
              <h3 className="sec-title">Команды</h3>
              <div className="proj-rows" aria-label="Приглашения в команды">
                {teamList.map((i) => (
                  <Fragment key={i.id}>
                    <div className="proj-row">
                      <div className="set-text">
                        <div className="set-label">{i.team_name}</div>
                        <div className="set-desc">
                          {i.invited_by_name ? `Пригласил(а) ${i.invited_by_name}` : 'Пригласили'} · {ROLE_LABELS[roleOf(i.role)]}
                        </div>
                      </div>
                      <div className="proj-actions">
                        <Button write variant="primary" disabled={busy === i.id} onClick={() => void answer(i.id, () => answerTeamInvite(i.id, true))}>
                          Принять
                        </Button>
                        <Button write disabled={busy === i.id} onClick={() => void answer(i.id, () => answerTeamInvite(i.id, false))}>
                          Отклонить
                        </Button>
                      </div>
                    </div>
                    {problem?.id === i.id && <RowProblem>{problem.text}</RowProblem>}
                  </Fragment>
                ))}
              </div>
            </section>
          )}
          {projectList.length > 0 && (
            <section>
              <h3 className="sec-title">Проекты</h3>
              <div className="proj-rows" aria-label="Приглашения в проекты">
                {projectList.map((i) => (
                  <Fragment key={i.id}>
                    <div className="proj-row">
                      <div className="set-text">
                        <div className="set-label">
                          <Sq color={`var(--${i.project_color})`} />
                          {i.project_name}
                        </div>
                        <div className="set-desc">
                          {i.invited_by_name ? `Пригласил(а) ${i.invited_by_name}` : 'Пригласили'} · {ROLE_LABELS[roleOf(i.role)]}
                        </div>
                      </div>
                      <div className="proj-actions">
                        <Button write variant="primary" disabled={busy === i.id} onClick={() => void answer(i.id, () => answerInvite(i.id, true))}>
                          Принять
                        </Button>
                        <Button write disabled={busy === i.id} onClick={() => void answer(i.id, () => answerInvite(i.id, false))}>
                          Отклонить
                        </Button>
                      </div>
                    </div>
                    {problem?.id === i.id && <RowProblem>{problem.text}</RowProblem>}
                  </Fragment>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </DialogFrame>
  )
}
