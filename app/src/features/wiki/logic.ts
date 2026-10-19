// Вики без React: дерево страниц, путь до страницы, отбор файлов библиотеки. Порт из vWiki макета.

import type { Folder, LibraryFile, WikiNode } from '../../lib/api/types'
import { fd, plural, todayIso } from '../../lib/date'

// ----- Дерево страниц -----

export type TreeRow = { node: WikiNode; depth: number; hasKids: boolean }

/**
 * Строки дерева. Страницы приходят в порядке `position`, соседи одного родителя идут как есть.
 * С поиском дерево плоское: все страницы, в названии которых есть искомое (у страницы без названия ищется «Без названия»).
 */
export function treeRows(pages: WikiNode[], open: Record<string, boolean>, query: string): TreeRow[] {
  const q = query.trim().toLowerCase()
  if (q) {
    return pages.filter((p) => (p.title || 'Без названия').toLowerCase().includes(q)).map((node) => ({ node, depth: 0, hasKids: false }))
  }
  const rows: TreeRow[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const node of pages.filter((p) => (p.parent_id ?? null) === parent)) {
      const hasKids = pages.some((x) => x.parent_id === node.id)
      rows.push({ node, depth, hasKids })
      if (hasKids && open[node.id]) walk(node.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}

/** Путь от корня до страницы, сама страница последняя */
export function pathTo(pages: WikiNode[], id: string | null): WikiNode[] {
  const path: WikiNode[] = []
  const seen = new Set<string>()
  let node = pages.find((p) => p.id === id)
  while (node && !seen.has(node.id)) {
    seen.add(node.id)
    path.unshift(node)
    const parent: string | null | undefined = node.parent_id
    node = parent ? pages.find((p) => p.id === parent) : undefined
  }
  return path
}

/** Страница по названию для ссылки `[[...]]`: без учёта регистра и пробелов по краям (openWiki в макете) */
export function findByTitle(pages: WikiNode[], title: string): WikiNode | undefined {
  const t = title.trim().toLowerCase()
  return pages.find((p) => (p.title || '').toLowerCase() === t)
}

/** Названия страниц в нижнем регистре: по ним ссылкам на несуществующие страницы ставится пометка */
export const lowerTitles = (pages: WikiNode[]): string[] => pages.map((p) => (p.title || '').toLowerCase())

/** Страница и все вложенные в неё */
export function subtreeIds(pages: WikiNode[], id: string): Set<string> {
  const ids = new Set([id])
  for (let grew = true; grew; ) {
    grew = false
    for (const p of pages) {
      if (p.parent_id && ids.has(p.parent_id) && !ids.has(p.id)) {
        ids.add(p.id)
        grew = true
      }
    }
  }
  return ids
}

/**
 * Список страниц после переноса: страница у нового родителя перед `beforeId` (null — последней среди его страниц).
 * Порядок соседей в дереве задаёт порядок в списке, поэтому достаточно переставить элемент.
 */
export function moveInList(pages: WikiNode[], id: string, parentId: string | null, beforeId: string | null): WikiNode[] {
  const node = pages.find((p) => p.id === id)
  if (!node) return pages
  const rest = pages.filter((p) => p.id !== id)
  let at = beforeId ? rest.findIndex((p) => p.id === beforeId) : -1
  if (at < 0) {
    const last = rest.findLastIndex((p) => (p.parent_id ?? null) === parentId)
    at = last < 0 ? rest.length : last + 1
  }
  return [...rest.slice(0, at), { ...node, parent_id: parentId }, ...rest.slice(at)]
}

/** Какая страница открыта: сохранённая, если она ещё есть, иначе первая в корне; страниц нет — null */
export function currentPage(pages: WikiNode[], id: string | null): WikiNode | null {
  return pages.find((p) => p.id === id) ?? pages.find((p) => !p.parent_id) ?? null
}

/** Родители страницы, которые надо раскрыть, чтобы она была видна в дереве */
export const ancestorsOf = (pages: WikiNode[], id: string): string[] => pathTo(pages, id).slice(0, -1).map((p) => p.id)

// ----- Файлы -----

export const FILE_KINDS = ['img', 'pdf', 'doc', 'sheet', 'zip', 'other'] as const
export type FileKind = (typeof FILE_KINDS)[number]

/** Подписи типов и индекс цвета в TONES (KINDS в макете) */
export const KINDS: Record<FileKind, { label: string; single: string; tone: number }> = {
  img: { label: 'Изображения', single: 'Изображение', tone: 3 },
  pdf: { label: 'PDF', single: 'PDF', tone: 0 },
  doc: { label: 'Документы', single: 'Документ', tone: 1 },
  sheet: { label: 'Таблицы', single: 'Таблица', tone: 5 },
  zip: { label: 'Архивы', single: 'Архив', tone: 6 },
  other: { label: 'Другое', single: 'Файл', tone: 2 },
}

export const kindOf = (file: { kind: string }): (typeof KINDS)[FileKind] => KINDS[file.kind as FileKind] ?? KINDS.other

/** Надпись на плитке файла: расширение, до четырёх букв */
export const fileExt = (name: string): string => (name.split('.').pop() || '').slice(0, 4).toUpperCase()

export const filesCount = (n: number): string => `${n} ${plural(n, 'файл', 'файла', 'файлов')}`

/** Дата файла: «сегодня» или «16 окт» (по часам этого компьютера) */
export function fileDate(createdAt: string, now: Date = new Date()): string {
  const day = todayIso(new Date(createdAt))
  return day === todayIso(now) ? 'сегодня' : fd(day)
}

export type LibraryQuery = { folder: string | null; kind: 'all' | FileKind; q: string }

export type LibraryView = {
  /** Поиск или фильтр по типу ищут во всех папках сразу, без списка папок */
  flat: boolean
  folders: { folder: Folder; count: number }[]
  files: LibraryFile[]
}

/** Что показать в библиотеке (vWiki в макете): в корне папки и файлы вне папок, в папке её файлы, при поиске всё подряд */
export function libraryView(files: LibraryFile[], folders: Folder[], { folder, kind, q }: LibraryQuery): LibraryView {
  const needle = q.trim().toLowerCase()
  const flat = !!needle || kind !== 'all'
  let list = files.filter((f) => (kind === 'all' || f.kind === kind) && (!needle || f.name.toLowerCase().includes(needle)))
  if (!flat) list = list.filter((f) => (f.folder_id ?? null) === folder)
  const shown = !flat && folder === null ? folders : []
  return {
    flat,
    files: list,
    folders: shown.map((f) => ({ folder: f, count: files.filter((x) => x.folder_id === f.id).length })),
  }
}

/** Где лежит файл: страница, папка или корень */
export function fileWhere(file: LibraryFile, pages: WikiNode[], folders: Folder[]): { text: string; page: WikiNode | null } {
  const page = file.wiki_page_id ? (pages.find((p) => p.id === file.wiki_page_id) ?? null) : null
  if (page) return { text: `Страница «${page.title || 'Без названия'}»`, page }
  const folder = file.folder_id ? folders.find((f) => f.id === file.folder_id) : null
  return { text: folder ? `Папка «${folder.name}»` : 'Корень', page: null }
}
