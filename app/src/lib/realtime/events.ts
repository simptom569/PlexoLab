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

export type Message =
  | { kind: 'ready' }
  | { kind: 'ping' }
  | { kind: 'resync' }
  | { kind: 'error'; code: string }
  | { kind: 'event'; event: ServerEvent }

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null)

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
    // имя и цвет аватара участника видны везде: в списках, карточках, комментариях и ленте
    case 'user.changed':
      return [keys.users]
    case 'activity.created':
      return [keys.activity]
    default:
      return []
  }
}
