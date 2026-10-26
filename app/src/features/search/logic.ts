// Поиск по названиям (docs/OFFLINE-NOTIFY-SEARCH.md, раздел 3): как результаты сервера превращаются в строки окна и как
// двигается выбор. Открывает найденное `open.ts`.

import type { IconName } from '../../components'
import { formatSize } from '../../lib/format'
import type { SearchResult } from '../../lib/api/types'

export type SearchKind = 'task' | 'doc' | 'wiki' | 'file'

/** Одна строка результата: всё, что нужно показать и чтобы открыть найденное */
export type SearchItem = {
  kind: SearchKind
  id: string
  /** Проект (у задач и документов): в него переключается приложение, когда открывают найденное */
  projectId: string | null
  /** id задачи для показа (`WEB-141`) */
  key: string | null
  title: string
  /** Где лежит: проект, «Вики» или «Файлы» с размером */
  where: string
  icon: IconName
}

/** Группы окна в порядке показа */
export const GROUPS: ReadonlyArray<{ kind: SearchKind; title: string }> = [
  { kind: 'task', title: 'Задачи' },
  { kind: 'doc', title: 'Документы' },
  { kind: 'wiki', title: 'Вики' },
  { kind: 'file', title: 'Файлы' },
]

/** Как назвать документ или страницу без названия */
export const UNTITLED = 'Без названия'

/** Все результаты одним списком в порядке групп: по нему идёт выбор стрелками */
export function flatten(result: SearchResult): SearchItem[] {
  return [
    ...result.tasks.map<SearchItem>((t) => ({
      kind: 'task',
      id: t.id,
      projectId: t.project_id,
      key: t.key,
      title: t.title,
      where: t.project_name,
      icon: 'board',
    })),
    ...result.docs.map<SearchItem>((d) => ({
      kind: 'doc',
      id: d.id,
      projectId: d.project_id,
      key: null,
      title: d.title.trim() || UNTITLED,
      where: d.project_name,
      icon: 'docs',
    })),
    ...result.wiki.map<SearchItem>((w) => ({
      kind: 'wiki',
      id: w.id,
      projectId: null,
      key: null,
      title: w.title.trim() || UNTITLED,
      where: 'Вики',
      icon: 'wiki',
    })),
    ...result.files.map<SearchItem>((f) => ({
      kind: 'file',
      id: f.id,
      projectId: null,
      key: null,
      title: f.name,
      where: `Файлы · ${formatSize(f.size_bytes)}`,
      icon: 'paperclip',
    })),
  ]
}

/** Строки одной группы с их номерами в общем списке */
export function inGroup(items: SearchItem[], kind: SearchKind): Array<{ item: SearchItem; index: number }> {
  return items.flatMap((item, index) => (item.kind === kind ? [{ item, index }] : []))
}

/** Куда переходит выбор по стрелке: по кругу, пустой список остаётся без выбора */
export function moveActive(current: number, step: 1 | -1, count: number): number {
  if (count === 0) return 0
  return (current + step + count) % count
}

/** Что сказать вместо списка: нет запроса, ищем, ничего нет */
export function emptyText(query: string, searching: boolean): string {
  if (query.trim() === '') return 'Начните печатать: найду задачи (и их id), документы, страницы вики и файлы по названию'
  return searching ? 'Ищу…' : 'Ничего не найдено'
}
