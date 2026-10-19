import { Button, EmptyState } from '../../components'
import { useUi } from '../../lib/ui-store'
import { ActiveFilters } from './ActiveFilters'
import { BoardHeader } from './BoardHeader'
import { BoardToolbar } from './BoardToolbar'
import { PillOverlay, CalendarView } from './CalendarView'
import { CardFace } from './CardFace'
import { BoardProvider } from './BoardProvider'
import { DragProvider } from './DragProvider'
import { END, type DragKind, type DragState } from './dnd'
import { GanttView } from './GanttView'
import { ColumnOverlay, KanbanView } from './KanbanView'
import { ListView } from './ListView'
import { useBoardModel, useModel, useMutations } from './model'
import { TableView } from './TableView'

/** Бросок на цель: карточка в колонку, колонка на место, плашка на день */
function useDropHandler() {
  const m = useModel()
  const { moveTask, updateColumn, updateTask } = useMutations()

  return (s: DragState) => {
    if (!s.id) return
    if (s.kind === 'col' && s.overSlot) {
      const i = m.columns.findIndex((c) => c.id === s.id)
      const next = i >= 0 ? (m.columns[i + 1]?.id ?? END) : null
      // на то же место: ничего не меняется
      if (s.overSlot === s.id || s.overSlot === next) return
      updateColumn.mutate({ id: s.id, patch: { before_id: s.overSlot === END ? null : s.overSlot } })
      return
    }
    if (s.kind !== 'card') return
    const task = m.onBoard.find((t) => t.id === s.id)
    if (!task) return
    if (s.overDay) {
      if (task.due_date !== s.overDay) updateTask.mutate({ id: task.id, patch: { due_date: s.overDay } })
      return
    }
    if (!s.overCol) return
    const items = m.shown.filter((t) => t.column_id === s.overCol)
    const i = items.findIndex((t) => t.id === s.id)
    const next = i >= 0 ? (items[i + 1]?.id ?? END) : null
    const before = s.overCard ?? END
    // возврат на то же место ничего не меняет
    if (before === s.id || before === next) return
    moveTask.mutate({ id: task.id, columnId: s.overCol, beforeId: before === END ? null : before })
  }
}

function Overlay({ kind, id }: { kind: DragKind; id: string }) {
  const m = useModel()
  const view = useUi((s) => s.view)
  if (kind === 'col') return <ColumnOverlay id={id} />
  if (view === 'cal') return <PillOverlay id={id} />
  const task = m.onBoard.find((t) => t.id === id)
  return task ? <CardFace task={task} overlay /> : null
}

function BoardScreen() {
  const view = useUi((s) => s.view)
  const onDrop = useDropHandler()
  return (
    <DragProvider onDrop={onDrop} renderOverlay={(kind, id) => <Overlay kind={kind} id={id} />}>
      <BoardHeader />
      <BoardToolbar />
      <ActiveFilters />
      {view === 'board' && <KanbanView />}
      {view === 'list' && <ListView />}
      {view === 'table' && <TableView />}
      {view === 'cal' && <CalendarView />}
      {view === 'gantt' && <GanttView />}
    </DragProvider>
  )
}

/** Страница «Доска» выбранного проекта */
export function BoardPage({ projectId }: { projectId: string }) {
  const loaded = useBoardModel(projectId)
  if (loaded.status === 'loading') return <EmptyState>Загружаю доску…</EmptyState>
  if (loaded.status === 'error') {
    return (
      <EmptyState>
        Не удалось загрузить доску
        <div style={{ marginTop: 12 }}>
          <Button onClick={loaded.retry}>Повторить</Button>
        </div>
      </EmptyState>
    )
  }
  return (
    <BoardProvider model={loaded.model}>
      <BoardScreen />
    </BoardProvider>
  )
}
