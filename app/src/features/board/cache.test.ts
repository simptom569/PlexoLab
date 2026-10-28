import { describe, expect, it } from 'vitest'
import type { Board, Column, Subtask, TaskCard, TaskDetail } from '../../lib/api/types'
import { cardOf, patchCard, patchColumn, patchDetail, placeColumn, placeTask, removeColumn, STEP, withSubtasks } from './cache'

const task = (id: string, column_id: string | null, position: number, patch: Partial<TaskCard> = {}): TaskCard => ({
  id, project_id: 'p', number: 1, key: 'WEB-1', title: id, column_id, position, priority: 'med', pr: '', tag_ids: [],
  subtasks_total: 0, subtasks_done: 0, updated_at: '2026-10-18T10:00:00Z', ...patch,
})
const col = (id: string, position: number): Column => ({ id, project_id: 'p', title: id, color: 'muted', is_done: false, position })
const ids = (tasks: TaskCard[], column: string | null) => tasks.filter((t) => (t.column_id ?? null) === column).map((t) => t.id)

describe('placeTask', () => {
  const tasks = [task('a', 'todo', 1024), task('b', 'todo', 2048), task('c', 'todo', 3072), task('x', 'doing', 1024), task('bk', null, 1024)]

  it('перед задачей в другой колонке', () => {
    const next = placeTask(tasks, 'a', 'doing', 'x')
    expect(ids(next, 'doing')).toEqual(['a', 'x'])
    expect(ids(next, 'todo')).toEqual(['b', 'c'])
    expect(next.find((t) => t.id === 'a')!.column_id).toBe('doing')
  })

  it('в середину: позиция между соседями', () => {
    const next = placeTask(tasks, 'x', 'todo', 'c')
    expect(ids(next, 'todo')).toEqual(['a', 'b', 'x', 'c'])
    expect(next.find((t) => t.id === 'x')!.position).toBe((2048 + 3072) / 2)
  })

  it('в начало колонки: позиция меньше первой', () => {
    const next = placeTask(tasks, 'x', 'todo', 'a')
    expect(ids(next, 'todo')).toEqual(['x', 'a', 'b', 'c'])
    expect(next.find((t) => t.id === 'x')!.position).toBe(1024 - STEP)
  })

  it('в конец: before null', () => {
    const next = placeTask(tasks, 'a', 'todo', null)
    expect(ids(next, 'todo')).toEqual(['b', 'c', 'a'])
    expect(next.find((t) => t.id === 'a')!.position).toBe(3072 + STEP)
  })

  it('в пустую колонку и в бэклог', () => {
    expect(placeTask(tasks, 'a', 'empty', null).find((t) => t.id === 'a')).toMatchObject({ column_id: 'empty', position: STEP })
    const next = placeTask(tasks, 'a', null, null)
    expect(ids(next, null)).toEqual(['bk', 'a'])
    expect(next.find((t) => t.id === 'a')!.column_id).toBeNull()
  })

  it('перенос внутри колонки не оставляет двойника', () => {
    const next = placeTask(tasks, 'a', 'todo', 'c')
    expect(next).toHaveLength(tasks.length)
    expect(ids(next, 'todo')).toEqual(['b', 'a', 'c'])
  })

  it('before из другой колонки считается «в конец»; чужой id не ломает', () => {
    expect(ids(placeTask(tasks, 'a', 'doing', 'c'), 'doing')).toEqual(['x', 'a'])
    expect(placeTask(tasks, 'нет такой', 'doing', null)).toBe(tasks)
  })

  it('не меняет исходный массив и остальные задачи', () => {
    const before = JSON.stringify(tasks)
    placeTask(tasks, 'a', 'doing', 'x')
    expect(JSON.stringify(tasks)).toBe(before)
  })
})

describe('колонки', () => {
  const columns = [col('a', 1024), col('b', 2048), col('c', 3072)]

  it('placeColumn: перед другой и в конец', () => {
    expect(placeColumn(columns, 'c', 'a').map((c) => c.id)).toEqual(['c', 'a', 'b'])
    expect(placeColumn(columns, 'a', null).map((c) => c.id)).toEqual(['b', 'c', 'a'])
    expect(placeColumn(columns, 'a', null).map((c) => c.position)).toEqual([1024, 2048, 3072])
  })

  it('patchColumn: название, цвет, «Готово», порядок', () => {
    const next = patchColumn(columns, 'b', { title: 'Б', color: 'ok', is_done: true })
    expect(next[1]).toMatchObject({ title: 'Б', color: 'ok', is_done: true })
    expect(next[0]).toEqual(columns[0])
    expect(patchColumn(columns, 'b', { before_id: 'a' }).map((c) => c.id)).toEqual(['b', 'a', 'c'])
    expect(patchColumn(columns, 'b', { before_id: null }).map((c) => c.id)).toEqual(['a', 'c', 'b'])
    expect(patchColumn(columns, 'b', { title: 'Б' }).map((c) => c.id), 'без before_id порядок не меняется').toEqual(['a', 'b', 'c'])
  })

  it('removeColumn: задачи уходят в конец выбранной колонки в прежнем порядке', () => {
    const board: Board = {
      project: { id: 'p', key: 'WEB', name: 'Web', color: 'accent', role: 'admin', archived: false, team_id: 't', visibility: 'members', guest: false }, columns, milestones: [], modules: [], tags: [],
      tasks: [task('t1', 'a', 1024), task('t2', 'a', 2048), task('u1', 'b', 1024), task('u2', 'b', 5000)],
    }
    const next = removeColumn(board, 'a', 'b')
    expect(next.columns.map((c) => c.id)).toEqual(['b', 'c'])
    expect(ids(next.tasks, 'b')).toEqual(['u1', 'u2', 't1', 't2'])
    expect(next.tasks.some((t) => t.column_id === 'a')).toBe(false)
  })
})

describe('правки полей', () => {
  const card = task('a', 'todo', 1024, { assignee_id: 'u1', due_date: '2026-10-20', tag_ids: ['x'] })

  it('меняет переданное, очищает null у необязательных, остальное не трогает', () => {
    expect(patchCard(card, { title: 'Новое', priority: 'high', pr: '#1', tag_ids: ['y', 'z'] })).toMatchObject({
      title: 'Новое', priority: 'high', pr: '#1', tag_ids: ['y', 'z'], assignee_id: 'u1', due_date: '2026-10-20',
    })
    expect(patchCard(card, { assignee_id: null, due_date: null, module_id: 'm' })).toMatchObject({ assignee_id: null, due_date: null, module_id: 'm' })
    expect(patchCard(card, { title: null, priority: null }), 'null у обязательных полей игнорируется').toMatchObject({ title: 'a', priority: 'med' })
    expect(patchCard(card, {})).toEqual(card)
  })

  it('patchDetail ещё меняет описание', () => {
    const detail = { ...cardOf({ ...card, description: 'было', subtasks: [], comments: [], files: [], created_at: 'x' } as TaskDetail), description: 'было', subtasks: [], comments: [], files: [], created_at: 'x' } as TaskDetail
    expect(patchDetail(detail, { description: 'стало', title: 'T' })).toMatchObject({ description: 'стало', title: 'T' })
    expect(patchDetail(detail, { description: null }).description).toBe('было')
  })

  it('подзадачи: счётчики карточки', () => {
    const subs: Subtask[] = [
      { id: '1', title: 'a', done: true, position: 1 },
      { id: '2', title: 'b', done: false, position: 2 },
      { id: '3', title: 'c', done: true, position: 3 },
    ]
    expect(withSubtasks(card, subs)).toMatchObject({ subtasks_total: 3, subtasks_done: 2 })
  })
})
