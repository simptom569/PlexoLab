import { Fragment, useState } from 'react'
import { Button, Sq } from '../../components'
import { useArchivedProjects, useArchivedTeams } from '../../lib/api/queries'
import { failed } from '../../lib/query'
import { useUi } from '../../lib/ui-store'
import { restoreTeam } from '../teams/api'
import { errorText, setArchived } from './api'
import { DialogFrame, Problem, RowProblem } from './parts'

/**
 * «Архив проектов»: проекты и команды, которые я убрал из списка. «Вернуть» возвращает проект или команду в боковое меню
 * (docs/TEAMS.md, 4.5: второй раздел «Команды»).
 */
export function ArchiveDialog() {
  const close = useUi((s) => s.closeProjectDialog)
  const archived = useArchivedProjects()
  const archivedTeams = useArchivedTeams()
  const [busy, setBusy] = useState<string | null>(null)
  // ошибка стоит под тем, что не удалось вернуть
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null)

  const restore = async (id: string, work: () => Promise<void>) => {
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

  const projects = archived.data ?? []
  const teams = archivedTeams.data ?? []
  return (
    <DialogFrame title="Архив проектов" narrow onClose={close}>
      {archived.isPending || archivedTeams.isPending ? (
        <div className="empty">Загружаю…</div>
      ) : failed(archived) || failed(archivedTeams) ? (
        <Problem>Не удалось загрузить архив</Problem>
      ) : projects.length + teams.length === 0 ? (
        <div className="empty">Архив пуст</div>
      ) : (
        <>
          {projects.length > 0 && (
            <section>
              <h3 className="sec-title">Проекты</h3>
              <div className="proj-rows" aria-label="Архивные проекты">
                {projects.map((p) => (
                  <Fragment key={p.id}>
                    <div className="proj-row">
                      <div className="set-label">
                        <Sq color={`var(--${p.color})`} />
                        {p.name}
                      </div>
                      <Button write disabled={busy === p.id} onClick={() => void restore(p.id, () => setArchived(p.id, false))}>
                        Вернуть
                      </Button>
                    </div>
                    {problem?.id === p.id && <RowProblem>{problem.text}</RowProblem>}
                  </Fragment>
                ))}
              </div>
            </section>
          )}
          {teams.length > 0 && (
            <section>
              <h3 className="sec-title">Команды</h3>
              <div className="proj-rows" aria-label="Архивные команды">
                {teams.map((t) => (
                  <Fragment key={t.id}>
                    <div className="proj-row">
                      <div className="set-label">{t.name}</div>
                      <Button write disabled={busy === t.id} onClick={() => void restore(t.id, () => restoreTeam(t.id))}>
                        Вернуть
                      </Button>
                    </div>
                    {problem?.id === t.id && <RowProblem>{problem.text}</RowProblem>}
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
