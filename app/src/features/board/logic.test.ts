import { describe, expect, it } from 'vitest'
import type { Column, TaskCard, User } from '../../lib/api/types'
import { EMPTY_FILTERS, type Filters } from '../../lib/settings'
import {
  calendarCells, doneColumnIds, dueInfo, ganttLabel, ganttRows, ganttStart, ganttTicks, ganttToday, isDone, isVisible, nextSort, NONE,
  shiftMonth, sortTasks, splitTasks,
} from './logic'

const TODAY = '2026-10-18'
const col = (id: string, title: string, is_done = false): Column => ({ id, project_id: 'p', title, color: 'muted', is_done, position: 0 })
const columns = [col('todo', 'К выполнению'), col('doing', 'В работе'), col('done', 'Готово', true)]
const done = doneColumnIds(columns)

let n = 0
const task = (patch: Partial<TaskCard> = {}): TaskCard => {
  n++
  return {
    id: `t${n}`, project_id: 'p', number: n, key: `WEB-${n}`, title: `Задача ${n}`, column_id: 'todo', position: n * 1024, priority: 'med',
    pr: '', tag_ids: [], subtasks_total: 0, subtasks_done: 0, updated_at: '2026-10-18T10:00:00Z', ...patch,
  }
}
const f = (patch: Partial<Filters> = {}): Filters => ({ ...EMPTY_FILTERS, ...patch })
const vis = (t: TaskCard, filters: Filters = EMPTY_FILTERS, q = '') => isVisible(t, filters, q, TODAY, done)

describe('готовность и срок', () => {
  it('задача готова, если лежит в колонке с флагом «Готово»', () => {
    expect(isDone(task({ column_id: 'done' }), done)).toBe(true)
    expect(isDone(task({ column_id: 'todo' }), done)).toBe(false)
    expect(isDone(task({ column_id: null }), done), 'бэклог').toBe(false)
  })

  it('просрочено: срок раньше сегодняшнего и задача не готова', () => {
    expect(dueInfo(task({ due_date: '2026-10-17' }), TODAY, done)).toEqual({ text: '17 окт', late: true })
    expect(dueInfo(task({ due_date: '2026-10-18' }), TODAY, done).late, 'сегодня ещё не просрочено').toBe(false)
    expect(dueInfo(task({ due_date: '2026-10-10', column_id: 'done' }), TODAY, done).late, 'готовая не краснеет').toBe(false)
    expect(dueInfo(task(), TODAY, done)).toEqual({ text: '', late: false })
  })
})

describe('фильтры (внутри группы «или», между группами «и»)', () => {
  it('без фильтров видны все', () => {
    expect(vis(task())).toBe(true)
  })

  it('исполнитель, в том числе «без исполнителя»', () => {
    const lena = task({ assignee_id: 'u1' })
    const nobody = task({ assignee_id: null })
    expect([vis(lena, f({ who: ['u1'] })), vis(nobody, f({ who: ['u1'] }))]).toEqual([true, false])
    expect([vis(lena, f({ who: [NONE] })), vis(nobody, f({ who: [NONE] }))]).toEqual([false, true])
    expect([vis(lena, f({ who: ['u2', NONE] })), vis(nobody, f({ who: ['u2', NONE] }))]).toEqual([false, true])
  })

  it('приоритет, метка, модуль', () => {
    expect(vis(task({ priority: 'high' }), f({ prio: ['high', 'low'] }))).toBe(true)
    expect(vis(task({ priority: 'med' }), f({ prio: ['high', 'low'] }))).toBe(false)
    expect(vis(task({ tag_ids: ['a', 'b'] }), f({ tag: ['b', 'c'] }))).toBe(true)
    expect(vis(task({ tag_ids: ['a'] }), f({ tag: ['b'] }))).toBe(false)
    expect(vis(task({ tag_ids: [] }), f({ tag: ['b'] }))).toBe(false)
    expect(vis(task({ module_id: 'm1' }), f({ module: ['m1'] }))).toBe(true)
    expect(vis(task({ module_id: null }), f({ module: [NONE] }))).toBe(true)
    expect(vis(task({ module_id: 'm1' }), f({ module: [NONE] }))).toBe(false)
  })

  it('группы соединяются через «и»', () => {
    const t = task({ priority: 'high', assignee_id: 'u1' })
    expect(vis(t, f({ prio: ['high'], who: ['u1'] }))).toBe(true)
    expect(vis(t, f({ prio: ['high'], who: ['u2'] }))).toBe(false)
  })

  it('срок: просрочено, на этой неделе, без срока', () => {
    const late = task({ due_date: '2026-10-10' })
    const lateDone = task({ due_date: '2026-10-10', column_id: 'done' })
    const edge = task({ due_date: '2026-10-25' }) // сегодня + 7: ещё «на этой неделе»
    const beyond = task({ due_date: '2026-10-26' })
    const nodue = task()
    expect([late, lateDone, edge, beyond, nodue].map((t) => vis(t, f({ due: 'overdue' })))).toEqual([true, false, false, false, false])
    expect([late, lateDone, edge, beyond, nodue].map((t) => vis(t, f({ due: 'week' })))).toEqual([false, false, true, false, false])
    expect([late, edge, nodue].map((t) => vis(t, f({ due: 'none' })))).toEqual([false, false, true])
    expect(vis(task({ due_date: TODAY }), f({ due: 'week' })), 'сегодня входит в неделю').toBe(true)
  })

  it('поиск по номеру и названию без учёта регистра', () => {
    const t = task({ key: 'WEB-144', title: 'Вход через SSO' })
    expect(vis(t, EMPTY_FILTERS, 'web-144')).toBe(true)
    expect(vis(t, EMPTY_FILTERS, ' sso ')).toBe(true)
    expect(vis(t, EMPTY_FILTERS, 'вход через')).toBe(true)
    expect(vis(t, EMPTY_FILTERS, 'oauth')).toBe(false)
    expect(vis(t, EMPTY_FILTERS, '   ')).toBe(true)
  })
})

describe('splitTasks', () => {
  it('делит на доску и бэклог', () => {
    const a = task({ column_id: 'todo' })
    const b = task({ column_id: null })
    const c = task({ column_id: undefined })
    expect(splitTasks([a, b, c])).toEqual({ onBoard: [a], backlog: [b, c] })
  })
})

describe('сортировка таблицы', () => {
  const users = new Map<string, User>([
    ['u1', { id: 'u1', email: 'a', name: 'Лена М.', role: '', tone: 0, is_admin: false }],
    ['u2', { id: 'u2', email: 'b', name: 'Артём К.', role: '', tone: 1, is_admin: false }],
  ])
  const ctx = { columns, usersById: users }
  const a = task({ number: 10, key: 'WEB-10', title: 'б', priority: 'low', due_date: '2026-10-20', column_id: 'doing', assignee_id: 'u1' })
  const b = task({ number: 2, key: 'WEB-2', title: 'А', priority: 'high', due_date: null, column_id: 'done', assignee_id: null })
  const c = task({ number: 33, key: 'WEB-33', title: 'в', priority: 'med', due_date: '2026-10-19', column_id: 'todo', assignee_id: 'u2' })
  const order = (key: Parameters<typeof sortTasks>[1]['key'], dir: 1 | -1 = 1) => sortTasks([a, b, c], { key, dir }, ctx).map((t) => t.number)

  it('по номеру — числом, а не строкой', () => expect(order('id')).toEqual([2, 10, 33]))
  it('по ключу, потом по номеру', () => {
    const list = [task({ key: 'WEB-9' }), task({ key: 'SEO-11' }), task({ key: 'WEB-10' }), task({ key: 'SEO-2' }), task({ key: 'TASK-1' })]
    expect(sortTasks(list, { key: 'id', dir: 1 }, ctx).map((t) => t.key)).toEqual(['SEO-2', 'SEO-11', 'TASK-1', 'WEB-9', 'WEB-10'])
    expect(sortTasks(list, { key: 'id', dir: -1 }, ctx).map((t) => t.key)).toEqual(['WEB-10', 'WEB-9', 'TASK-1', 'SEO-11', 'SEO-2'])
  })
  it('по названию без учёта регистра', () => expect(order('title')).toEqual([2, 10, 33]))
  it('по статусу — как идут колонки', () => expect(order('status')).toEqual([33, 10, 2]))
  it('по исполнителю — по имени, без исполнителя последним', () => expect(order('who')).toEqual([33, 10, 2]))
  it('по приоритету — от высокого', () => expect(order('prio')).toEqual([2, 33, 10]))
  it('по сроку — без срока в конце', () => expect(order('due')).toEqual([33, 10, 2]))
  it('обратное направление', () => expect(order('id', -1)).toEqual([33, 10, 2]))
  it('не меняет исходный массив', () => {
    const list = [a, b, c]
    sortTasks(list, { key: 'id', dir: 1 }, ctx)
    expect(list).toEqual([a, b, c])
  })

  it('клик по заголовку: тот же столбец разворачивается, другой начинается с возрастания', () => {
    expect(nextSort({ key: 'id', dir: 1 }, 'id')).toEqual({ key: 'id', dir: -1 })
    expect(nextSort({ key: 'id', dir: -1 }, 'id')).toEqual({ key: 'id', dir: 1 })
    expect(nextSort({ key: 'id', dir: -1 }, 'due')).toEqual({ key: 'due', dir: 1 })
  })
})

describe('календарь', () => {
  it('октябрь 2026: пять недель с понедельника, соседние дни помечены', () => {
    const cells = calendarCells(2026, 9, [], TODAY)
    expect(cells).toHaveLength(35)
    expect(cells[0]).toMatchObject({ date: '2026-09-28', num: 28, inMonth: false })
    expect(cells[3]).toMatchObject({ date: '2026-10-01', num: 1, inMonth: true })
    expect(cells[34]).toMatchObject({ date: '2026-11-01', num: 1, inMonth: false })
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31)
    expect(cells.filter((c) => c.today).map((c) => c.date)).toEqual([TODAY])
  })

  it('число недель зависит от месяца', () => {
    expect(calendarCells(2027, 1, [], TODAY), 'февраль 2027 с понедельника, 28 дней').toHaveLength(28)
    expect(calendarCells(2026, 1, [], TODAY), 'февраль 2026 с воскресенья').toHaveLength(35)
    expect(calendarCells(2026, 7, [], TODAY), 'август 2026 с субботы, 31 день').toHaveLength(42)
  })

  it('неделя с воскресенья: октябрь 2026 начинается с 27 сентября и кончается 31 октября', () => {
    const cells = calendarCells(2026, 9, [], TODAY, 'sun')
    expect(cells).toHaveLength(35)
    expect(cells[0]).toMatchObject({ date: '2026-09-27', num: 27, inMonth: false })
    expect(cells[4]).toMatchObject({ date: '2026-10-01', num: 1, inMonth: true })
    expect(cells[34]).toMatchObject({ date: '2026-10-31', num: 31, inMonth: true })
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31)
    expect(cells.filter((c) => c.today).map((c) => c.date)).toEqual([TODAY])
  })

  it('неделя с воскресенья: число недель меняется вместе с началом', () => {
    expect(calendarCells(2026, 1, [], TODAY, 'sun'), 'февраль 2026 с воскресенья, ровно четыре недели').toHaveLength(28)
    expect(calendarCells(2027, 1, [], TODAY, 'sun'), 'февраль 2027 с понедельника').toHaveLength(35)
    expect(calendarCells(2026, 7, [], TODAY, 'sun'), 'август 2026 с субботы').toHaveLength(42)
  })

  it('раскладывает задачи по сроку', () => {
    const a = task({ due_date: '2026-10-20' })
    const b = task({ due_date: '2026-10-20' })
    const c = task({ due_date: '2026-10-21' })
    const d = task({ due_date: null })
    const cells = calendarCells(2026, 9, [a, b, c, d], TODAY)
    expect(cells.find((x) => x.date === '2026-10-20')!.tasks).toEqual([a, b])
    expect(cells.find((x) => x.date === '2026-10-21')!.tasks).toEqual([c])
    expect(cells.flatMap((x) => x.tasks)).toHaveLength(3)
  })

  it('shiftMonth переходит через границу года', () => {
    expect(shiftMonth(2026, 9, 1)).toEqual({ year: 2026, month: 10 })
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 })
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 })
  })
})

describe('диаграмма Ганта', () => {
  const start = ganttStart('2026-10-12', 0)

  it('окно: понедельник текущей недели, шаг 14 дней', () => {
    expect(start).toBe('2026-10-12')
    expect(ganttStart('2026-10-12', 1)).toBe('2026-10-26')
    expect(ganttStart('2026-10-12', -1)).toBe('2026-09-28')
    expect(ganttLabel(start)).toBe('12 окт – 22 ноя')
    expect(ganttTicks(start).map((t) => t.label)).toEqual(['12 окт', '19 окт', '26 окт', '2 ноя', '9 ноя', '16 ноя'])
    expect(ganttTicks(start).map((t) => Math.round(t.left))).toEqual([0, 17, 33, 50, 67, 83])
  })

  it('окно можно начать с воскресенья: «сегодня» (воскресенье) тогда в самом начале шкалы', () => {
    const sunday = ganttStart('2026-10-18', 0)
    expect(ganttTicks(sunday).map((t) => t.label)).toEqual(['18 окт', '25 окт', '1 ноя', '8 ноя', '15 ноя', '22 ноя'])
    expect(ganttToday(sunday, TODAY)).toBe(0)
  })

  it('«сегодня» на шкале и вне окна', () => {
    expect(ganttToday(start, TODAY)).toBeCloseTo((6 / 42) * 100, 5)
    expect(ganttToday(start, '2026-12-01')).toBeNull()
    expect(ganttToday(start, '2026-10-01')).toBeNull()
  })

  it('полоса от даты начала до срока включительно', () => {
    const t = task({ start_date: '2026-10-12', due_date: '2026-10-23' })
    const [row] = ganttRows([t], start)
    expect(row!.range).toBe('12 окт – 23 окт')
    expect(row!.left).toBe(0)
    expect(row!.width).toBeCloseTo((12 / 42) * 100, 5) // 12 дней: с 12 по 23 октября включительно
  })

  it('без даты начала — полоса в один день с подписью одной даты', () => {
    const [row] = ganttRows([task({ due_date: '2026-10-30' })], start)
    expect(row!.range).toBe('30 окт')
    expect(row!.width).toBeCloseTo((1 / 42) * 100, 5)
  })

  it('без срока и вне окна полос нет; частично видимые обрезаются по краям', () => {
    const nodue = task()
    const before = task({ start_date: '2026-09-01', due_date: '2026-09-20' })
    const after = task({ start_date: '2026-12-01', due_date: '2026-12-05' })
    const cut = task({ start_date: '2026-10-01', due_date: '2026-10-14' })
    const rows = ganttRows([nodue, before, after, cut], start)
    expect(rows.map((r) => r.task)).toEqual([cut])
    expect(rows[0]!.left).toBe(0)
    expect(rows[0]!.width).toBeCloseTo((3 / 42) * 100, 5) // видны только 12, 13 и 14 октября
  })

  it('порядок по дате начала (или срока)', () => {
    const late = task({ start_date: '2026-10-20', due_date: '2026-10-22' })
    const early = task({ start_date: '2026-10-13', due_date: '2026-10-30' })
    const only = task({ due_date: '2026-10-15' })
    expect(ganttRows([late, early, only], start).map((r) => r.task)).toEqual([early, only, late])
  })
})
