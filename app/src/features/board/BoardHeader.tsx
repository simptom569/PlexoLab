import { Button, Icon, ProgressBar, Sq } from '../../components'
import { plural } from '../../lib/date'
import { useUi } from '../../lib/ui-store'
import { colorVar, useModel, useMutations } from './model'

/** Заголовок доски: проект, сводка, прогресс «Готово», «Новая задача» */
export function BoardHeader() {
  const m = useModel()
  const { createTask } = useMutations()
  const openTask = useUi((s) => s.openTask)
  const total = m.onBoard.length
  const done = m.onBoard.filter(m.done).length
  const first = m.columns[0]

  const newTask = () => {
    if (!first || createTask.isPending) return
    createTask.mutate({ columnId: first.id, title: 'Новая задача' }, { onSuccess: (task) => openTask(task.id, { focusTitle: true }) })
  }

  return (
    <header style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 24px', alignItems: 'flex-end', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 13 }}>
          <Sq color={colorVar(m.board.project.color)} />
          <span>{m.board.project.name}</span>
        </div>
        <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.15, fontWeight: 700, letterSpacing: '-0.02em' }}>Доска</h1>
        <p style={{ margin: 0, color: 'var(--muted)' }}>{`${total} ${plural(total, 'задача', 'задачи', 'задач')} на доске · ${m.backlog.length} в бэклоге`}</p>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 180 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
            <span style={{ color: 'var(--muted)' }}>Готово</span>
            <span style={{ fontWeight: 600 }}>{`${done} из ${total}`}</span>
          </div>
          <ProgressBar ok pct={total ? Math.round((done / total) * 100) : 0} />
        </div>
        <Button write variant="primary" onClick={newTask}>
          <Icon name="plus" />
          Новая задача
        </Button>
      </div>
    </header>
  )
}
