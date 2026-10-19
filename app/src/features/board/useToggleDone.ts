import type { TaskCard } from '../../lib/api/types'
import { useModel, useMutations } from './model'

/** «Выполнена» ставится переносом в колонку «Готово», снятие возвращает в первую не «Готово» (toggleDoneTask в макете) */
export function useToggleDone() {
  const m = useModel()
  const { moveTask } = useMutations()
  return (task: TaskCard) => {
    const done = m.columns.find((c) => c.is_done)
    const first = m.columns.find((c) => !c.is_done)
    const to = m.done(task) ? (first?.id ?? task.column_id ?? null) : (done?.id ?? task.column_id ?? null)
    if (to !== (task.column_id ?? null)) moveTask.mutate({ id: task.id, columnId: to, beforeId: null })
  }
}
