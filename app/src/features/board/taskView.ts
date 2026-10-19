import type { Module, Priority, Tag, TaskCard, User } from '../../lib/api/types'
import { dueInfo } from './logic'
import type { BoardModel } from './model'

export interface TaskView {
  /** Исполнитель; undefined — без исполнителя */
  who: User | undefined
  /** Метки в порядке, как они стоят у задачи (неизвестные пропускаются) */
  tags: Tag[]
  module: Module | undefined
  due: { text: string; late: boolean }
  priority: Priority
}

/** Всё, что нужно показать про задачу (cardV в макете) */
export function describeTask(task: TaskCard, m: BoardModel): TaskView {
  return {
    who: task.assignee_id ? m.usersById.get(task.assignee_id) : undefined,
    tags: task.tag_ids.map((id) => m.tagsById.get(id)).filter((t): t is Tag => !!t),
    module: task.module_id ? m.modulesById.get(task.module_id) : undefined,
    due: dueInfo(task, m.today, m.doneIds),
    priority: task.priority as Priority,
  }
}
