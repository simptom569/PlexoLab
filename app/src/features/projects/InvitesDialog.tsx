import { Fragment, useState } from 'react'
import { Button, Sq } from '../../components'
import { useMyInvites } from '../../lib/api/queries'
import { failed } from '../../lib/query'
import { ROLE_LABELS, roleOf } from '../../lib/project-dialogs'
import { useUi } from '../../lib/ui-store'
import { answerInvite, errorText } from './api'
import { DialogFrame, Problem, RowProblem } from './parts'

/** «Приглашения»: проекты, куда меня позвали и где я ещё не ответил. Принять или отклонить. */
export function InvitesDialog() {
  const close = useUi((s) => s.closeProjectDialog)
  const invites = useMyInvites()
  const [busy, setBusy] = useState<string | null>(null)
  // ошибка стоит под приглашением, на которое не удалось ответить
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null)

  const answer = async (id: string, accept: boolean) => {
    setBusy(id)
    setProblem(null)
    try {
      await answerInvite(id, accept)
    } catch (e) {
      setProblem({ id, text: errorText(e) })
    } finally {
      setBusy(null)
    }
  }

  const list = invites.data ?? []
  return (
    <DialogFrame title="Приглашения" narrow onClose={close}>
      {invites.isPending ? (
        <div className="empty">Загружаю…</div>
      ) : failed(invites) ? (
        <Problem>Не удалось загрузить приглашения</Problem>
      ) : list.length === 0 ? (
        <div className="empty">Приглашений нет</div>
      ) : (
        <div className="proj-rows" aria-label="Приглашения в проекты">
          {list.map((i) => (
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
                  <Button write variant="primary" disabled={busy === i.id} onClick={() => void answer(i.id, true)}>
                    Принять
                  </Button>
                  <Button write disabled={busy === i.id} onClick={() => void answer(i.id, false)}>
                    Отклонить
                  </Button>
                </div>
              </div>
              {problem?.id === i.id && <RowProblem>{problem.text}</RowProblem>}
            </Fragment>
          ))}
        </div>
      )}
    </DialogFrame>
  )
}
