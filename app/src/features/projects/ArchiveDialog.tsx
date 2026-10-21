import { useState } from 'react'
import { Button, Sq } from '../../components'
import { useArchivedProjects } from '../../lib/api/queries'
import { useUi } from '../../lib/ui-store'
import { errorText, setArchived } from './api'
import { DialogFrame, Problem } from './parts'

/** «Архив проектов»: проекты, которые я убрал из списка. «Вернуть» возвращает проект в боковое меню. */
export function ArchiveDialog() {
  const close = useUi((s) => s.closeProjectDialog)
  const archived = useArchivedProjects()
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const restore = async (id: string) => {
    setBusy(id)
    setProblem(null)
    try {
      await setArchived(id, false)
    } catch (e) {
      setProblem(errorText(e))
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
            <div className="proj-row" key={p.id}>
              <div className="set-label">
                <Sq color={`var(--${p.color})`} />
                {p.name}
              </div>
              <Button disabled={busy === p.id} onClick={() => void restore(p.id)}>
                Вернуть
              </Button>
            </div>
          ))}
        </div>
      )}
      {problem && <Problem>{problem}</Problem>}
    </DialogFrame>
  )
}
