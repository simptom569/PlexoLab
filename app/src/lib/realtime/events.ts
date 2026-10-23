// События с сервера (WebSocket /api/v1/ws) и то, какие запросы TanStack Query они делают устаревшими.
// Данных в событии нет, только «что поменялось»: клиент перечитывает нужное (docs/DATA-MODEL.md, раздел про WebSocket).

import type { QueryKey } from '@tanstack/react-query'
import { keys } from '../api/queries'

/** Событие об изменении. `id` и `project_id` сервер ставит, только если знает; без них перечитывается всё такого рода. */
export type ServerEvent = {
  type: string
  id: string | null
  project_id: string | null
  /** Метка клиента, чей запрос это вызвал (`X-Client-Id`) */
  origin: string | null
}

/** Блок, в котором сейчас человек (присутствие): строки `[start, end)` текста версии `rev` у того, кто его открыл */
export type PresenceMark = {
  /** Подключение: у одного человека их может быть несколько (приложение запущено дважды, два компьютера) */
  client: string
  user_id: string
  kind: 'wiki' | 'doc'
  id: string
  rev: number
  start: number
  end: number
}

export type Message =
  | { kind: 'ready' }
  | { kind: 'ping' }
  | { kind: 'resync' }
  | { kind: 'error'; code: string }
  | { kind: 'event'; event: ServerEvent }
  /** Все метки сейчас: заменяют то, что клиент знал */
  | { kind: 'presence'; marks: PresenceMark[] }
  | { kind: 'presence.set'; mark: PresenceMark }
  | { kind: 'presence.gone'; client: string }

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** Метка присутствия; `null`, если в ней чего-то не хватает или она нелепая */
export function parseMark(raw: unknown): PresenceMark | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const client = text(o.client)
  const user_id = text(o.user_id)
  const id = text(o.id)
  const { kind, rev, start, end } = o
  if (!client || !user_id || !id) return null
  if (kind !== 'wiki' && kind !== 'doc') return null
  const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0
  if (!whole(rev) || !whole(start) || !whole(end) || end <= start) return null
  return { client, user_id, kind, id, rev, start, end }
}

/** Разбирает сообщение сервера; `null`, если это не JSON-объект с полем `type` */
export function parseMessage(raw: string): Message | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null
  const o = data as Record<string, unknown>
  const type = text(o.type)
  if (!type) return null
  switch (type) {
    case 'ready':
    case 'ping':
    case 'resync':
      return { kind: type }
    case 'error':
      return { kind: 'error', code: text(o.code) ?? 'error' }
    case 'presence': {
      const list = Array.isArray(o.marks) ? o.marks : []
      return { kind: 'presence', marks: list.map(parseMark).filter((m): m is PresenceMark => m !== null) }
    }
    case 'presence.set': {
      const mark = parseMark(o.mark)
      return mark && { kind: 'presence.set', mark }
    }
    case 'presence.gone': {
      const client = text(o.client)
      return client ? { kind: 'presence.gone', client } : null
    }
    default:
      return { kind: 'event', event: { type, id: text(o.id), project_id: text(o.project_id), origin: text(o.origin) } }
  }
}

/** Все запросы такого рода, когда сервер не сказал, какой именно */
const ALL_BOARDS: QueryKey = ['board']
const ALL_TASKS: QueryKey = ['task']
const ALL_RELEASES: QueryKey = ['releases']
const ALL_WIKI_PAGES: QueryKey = ['wiki-page']
const ALL_DOCS: QueryKey = ['doc']
const ALL_MEMBERS: QueryKey = ['members']

/**
 * Какие запросы перечитать. Запрос, который сейчас никто не смотрит, только помечается устаревшим и перечитается,
 * когда его откроют; перечитываются сразу лишь те, что на экране.
 */
export function queryKeysFor(e: ServerEvent): QueryKey[] {
  const board: QueryKey[] = [e.project_id ? keys.board(e.project_id) : ALL_BOARDS]
  const task: QueryKey[] = [e.id ? keys.task(e.id) : ALL_TASKS]
  const doc: QueryKey[] = [e.id ? keys.doc(e.id) : ALL_DOCS]

  switch (e.type) {
    case 'task.created':
    case 'task.updated':
    case 'task.deleted':
      return [...board, ...task]
    // задачи переехали (удалили колонку): и доска, и все открытые задачи
    case 'task.moved':
      return [...board, ALL_TASKS]
    // модули, вехи и метки приходят в ответе доски
    case 'column.changed':
    case 'module.changed':
    case 'milestone.changed':
    case 'tag.changed':
      return board
    case 'comment.created':
      return task
    case 'release.changed':
      return [e.project_id ? keys.releases(e.project_id) : ALL_RELEASES]
    case 'wiki.updated':
      return [keys.wiki, e.id ? keys.wikiPage(e.id) : ALL_WIKI_PAGES]
    case 'doc.updated':
      return [keys.docs, ...doc]
    case 'doc.canvas':
      return doc
    // вложения лежат в библиотеке и в открытых задачах
    case 'file.changed':
      return [keys.files, keys.folders, ALL_TASKS]
    case 'link.changed':
      return [keys.linkGroups]
    // проект, его настройки или состав участников изменились: список проектов (боковое меню) и его доска
    case 'project.changed':
      return [keys.projects, ...board, ALL_TASKS, e.project_id ? keys.members(e.project_id) : ALL_MEMBERS]
    // чьё-то приглашение в проект появилось, принято или отозвано
    case 'invite.changed':
      return [keys.invites]
    // имя и цвет аватара участника видны везде: в списках, карточках, комментариях и ленте
    case 'user.changed':
      return [keys.users]
    case 'activity.created':
      return [keys.activity]
    default:
      return []
  }
}
