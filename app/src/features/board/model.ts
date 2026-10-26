// Данные доски для экранов: ответ сервера плюс всё, что из него выводится (видимые задачи, справочники, «сегодня»).
// Компоненты берут модель из контекста и не пересчитывают её сами.

import { createContext, useContext, useMemo } from 'react'
import { useBoard, useMembers, useUsers } from '../../lib/api/queries'
import type { Board, Column, Module, Milestone, Tag, TaskCard, User } from '../../lib/api/types'
import { useSession } from '../../lib/session'
import { failed } from '../../lib/query'
import { useUi } from '../../lib/ui-store'
import { useToday } from '../../lib/useToday'
import { assigneeChoices, doneColumnIds, isDone, isVisible, pickablePeople, splitTasks } from './logic'
import type { BoardMutations } from './mutations'

/** Цвета колонок: токены сервера (board::COLUMN_COLORS) и переменные CSS макета (COLCOL) */
export const COLUMN_COLORS = ['muted', 'accent', 'warn', 'ok', 'b-fg', 'e-fg'] as const
export const colorVar = (token: string): string => `var(--${token})`

export interface BoardModel {
  board: Board
  projectId: string
  me: User
  users: User[]
  /** Участники проекта: только их можно назначить исполнителем (пока список не пришёл, все аккаунты) */
  members: User[]
  /** Кого предлагает фильтр «Исполнитель»: участники и все, у кого в проекте есть задачи */
  assignees: User[]
  /** Кого можно выбрать исполнителем или ответственным: участники проекта и текущий выбранный (вышедший остаётся) */
  pickable: (currentId: string | null | undefined) => User[]
  usersById: Map<string, User>
  tagsById: Map<string, Tag>
  modulesById: Map<string, Module>
  milestonesById: Map<string, Milestone>
  columns: Column[]
  doneIds: Set<string>
  /** Задачи на доске (в колонках) и в бэклоге, без учёта фильтров */
  onBoard: TaskCard[]
  backlog: TaskCard[]
  /** Задачи на доске, прошедшие фильтры и поиск */
  shown: TaskCard[]
  today: string
  done: (task: TaskCard) => boolean
}

const byId = <T extends { id: string }>(list: T[]): Map<string, T> => new Map(list.map((x) => [x.id, x]))

export interface Ctx {
  model: BoardModel
  mutations: BoardMutations
}

export const BoardContext = createContext<Ctx | null>(null)

export function useBoardCtx(): Ctx {
  const ctx = useContext(BoardContext)
  if (!ctx) throw new Error('useBoardCtx вне BoardProvider')
  return ctx
}
export const useModel = (): BoardModel => useBoardCtx().model
export const useMutations = (): BoardMutations => useBoardCtx().mutations

type Loaded = { status: 'loading' } | { status: 'error'; retry: () => void } | { status: 'ready'; model: BoardModel }

/** Загружает доску проекта и считает модель. Пока данных нет, отдаёт `loading`, при ошибке `error`. */
export function useBoardModel(projectId: string): Loaded {
  const board = useBoard(projectId)
  const users = useUsers()
  const memberList = useMembers(projectId)
  const me = useSession((s) => s.user)
  const filters = useUi((s) => s.filters)
  const query = useUi((s) => s.q)
  const today = useToday()

  const data = board.data
  const userList = users.data
  const base = useMemo(() => {
    if (!data || !userList || !me) return null
    const columns = data.columns.slice().sort((a, b) => a.position - b.position)
    const doneIds = doneColumnIds(columns)
    const { onBoard, backlog } = splitTasks(data.tasks)
    return {
      columns,
      doneIds,
      onBoard,
      backlog,
      usersById: byId(userList),
      tagsById: byId(data.tags),
      modulesById: byId(data.modules),
      milestonesById: byId(data.milestones),
    }
  }, [data, userList, me])

  const shown = useMemo(
    () => (base ? base.onBoard.filter((t) => isVisible(t, filters, query, today, base.doneIds)) : []),
    [base, filters, query, today],
  )

  // ошибка только если показать нечего: загруженное остаётся на экране, пока нет связи (lib/link.ts)
  if (failed(board) || failed(users)) return { status: 'error', retry: () => void Promise.all([board.refetch(), users.refetch()]) }
  if (!data || !userList || !me || !base) return { status: 'loading' }

  // пока список участников не пришёл, выбирать можно любого: как и раньше, без пустого списка
  const memberIds = memberList.data ? new Set(memberList.data.members.map((m) => m.user_id)) : null
  const model: BoardModel = {
    board: data,
    projectId,
    me,
    users: userList,
    members: memberList.data ? userList.filter((u) => memberList.data.members.some((m) => m.user_id === u.id)) : userList,
    assignees: assigneeChoices(userList, memberIds, data.tasks),
    pickable: (currentId) => pickablePeople(userList, memberIds, currentId),
    ...base,
    shown,
    today,
    done: (task) => isDone(task, base.doneIds),
  }
  return { status: 'ready', model }
}
