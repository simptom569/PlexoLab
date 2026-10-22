import { Fragment, useState } from 'react'
import { Button, Sq } from '../../components'
import { useArchivedProjects } from '../../lib/api/queries'
import { useUi } from '../../lib/ui-store'
import { errorText, setArchived } from './api'
import { DialogFrame, Problem, RowProblem } from './parts'

/** «Архив проектов»: проекты, которые я убрал из списка. «Вернуть» возвращает проект в боковое меню. */
export function ArchiveDialog() {
  const close = useUi((s) => s.closeProjectDialog)
  const archived = useArchivedProjects()
  const [busy, setBusy] = useState<string | null>(null)
  // ошибка стоит под проектом, который не удалось вернуть
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null)

  const restore = async (id: string) => {
    setBusy(id)
    setProblem(null)
    try {
      await setArchived(id, false)
    } catch (e) {
      setProblem({ id, text: errorText(e) })
    } finally {
      setBusy(null)
    }
  }

  const list = archived.data ?? []
  return (
    <DialogFrame title="Архив проектов" narrow onClose={close}>
      {archived.isPending ? (
        <div className="empty">Загружаю…</div>
      ) : archived.isError ? (
        <Problem>Не удалось загрузить архив</Problem>
      ) : list.length === 0 ? (
        <div className="empty">Архив пуст</div>
      ) : (
        <div className="proj-rows" aria-label="Архивные проекты">
          {list.map((p) => (
            <Fragment key={p.id}>
              <div className="proj-row">
                <div className="set-label">
                  <Sq color={`var(--${p.color})`} />
                  {p.name}
                </div>
                <Button disabled={busy === p.id} onClick={() => void restore(p.id)}>
                  Вернуть
                </Button>
              </div>
              {problem?.id === p.id && <RowProblem>{problem.text}</RowProblem>}
            </Fragment>
          ))}
        </div>
      )}
    </DialogFrame>
  )
}
