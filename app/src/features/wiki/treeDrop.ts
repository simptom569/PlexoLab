// Куда упадёт страница, которую тащат по дереву: чистая логика без DOM. Что под указателем, определяет TreeDrag.tsx.
//
// Строка делится по высоте на три зоны: верхняя четверть — «перед этой страницей», нижняя четверть — «после неё»,
// середина — «внутрь неё, в конец вложенных». У раскрытой страницы «после» означает после всей её ветки (на её уровне),
// а у последней строки ветки горизонтальное положение указателя выбирает уровень: правее — последней вложенной
// в эту ветку, левее — после родителя, ещё левее — после родителя родителя.

import type { WikiNode } from '../../lib/api/types'
import { subtreeIds, type TreeRow } from './logic'

/** Отступ вложенности: у строки глубины `d` `padding-left` равен `BASE_PAD + d * INDENT` (см. WikiTree) */
export const INDENT = 16
export const BASE_PAD = 6
/** Доля высоты строки сверху и снизу, которая значит «перед» и «после» */
export const EDGE = 0.25

export type Drop =
  /** Внутрь страницы, в конец вложенных: строка подсвечена, заглушки нет */
  | { kind: 'into'; parentId: string }
  /** Заглушка до или после видимой строки `anchorId`; на сервер уходит родитель и «перед какой страницей» */
  | { kind: 'gap'; parentId: string | null; beforeId: string | null; depth: number; anchorId: string; side: 'before' | 'after' }

/** Куда указывает указатель */
export type Hover = {
  /** Строка под указателем; null — указатель ниже последней строки */
  overId: string | null
  /** Положение по высоте строки: 0 — верхний край, 1 — нижний */
  fy: number
  /** Уровень вложенности, на который указывает положение по горизонтали */
  level: number
}

/** Уровень вложенности по горизонтали: `rowLeft` — левый край строк дерева */
export const levelAt = (x: number, rowLeft: number): number => Math.floor((x - rowLeft - BASE_PAD) / INDENT)

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export function resolveDrop(pages: WikiNode[], rows: TreeRow[], dragId: string, hover: Hover): Drop | null {
  const dragged = pages.find((p) => p.id === dragId)
  if (!dragged) return null
  const hidden = subtreeIds(pages, dragId)
  const visible = rows.filter((r) => !hidden.has(r.node.id))
  const childrenOf = (parent: string | null) => pages.filter((p) => (p.parent_id ?? null) === parent)

  // над самой страницей и её вложенными бросать некуда
  if (hover.overId !== null && hidden.has(hover.overId)) return null

  const at = hover.overId === null ? visible.length - 1 : visible.findIndex((r) => r.node.id === hover.overId)
  if (at < 0) return null
  const row = visible[at]!
  const fy = hover.overId === null ? 1 : hover.fy

  let drop: Drop
  if (fy < EDGE) {
    drop = { kind: 'gap', parentId: row.node.parent_id ?? null, beforeId: row.node.id, depth: row.depth, anchorId: row.node.id, side: 'before' }
  } else if (fy <= 1 - EDGE) {
    drop = { kind: 'into', parentId: row.node.id }
  } else {
    // после строки и всей её раскрытой ветки; уровень выбирают из тех, на которых эта строка последняя в своей ветке
    const levels: Array<{ node: WikiNode; depth: number }> = [{ node: row.node, depth: row.depth }]
    for (let x = row.node; x.parent_id; ) {
      const siblings = childrenOf(x.parent_id).filter((s) => s.id !== dragId)
      if (siblings.at(-1)?.id !== x.id) break
      const parent = pages.find((p) => p.id === x.parent_id)
      const parentRow = visible.find((r) => r.node.id === x.parent_id)
      if (!parent || !parentRow) break
      levels.push({ node: parent, depth: parentRow.depth })
      x = parent
    }
    const depth = clamp(hover.level, levels.at(-1)!.depth, row.depth)
    const target = levels.find((l) => l.depth === depth)!.node
    const siblings = childrenOf(target.parent_id ?? null).filter((s) => s.id !== dragId)
    const next = siblings[siblings.findIndex((s) => s.id === target.id) + 1]
    let last = at
    while (visible[last + 1] && visible[last + 1]!.depth > row.depth) last++
    drop = {
      kind: 'gap',
      parentId: target.parent_id ?? null,
      beforeId: next?.id ?? null,
      depth,
      anchorId: visible[last]!.node.id,
      side: 'after',
    }
  }

  // возврат на прежнее место: ни заглушки, ни переноса
  const parent = drop.parentId
  if ((dragged.parent_id ?? null) === parent) {
    const siblings = childrenOf(parent)
    const next = siblings[siblings.findIndex((s) => s.id === dragId) + 1]
    const before = drop.kind === 'into' ? null : drop.beforeId
    if ((next?.id ?? null) === before) return null
  }
  return drop
}

export const sameDrop = (a: Drop | null, b: Drop | null): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    a.kind === b.kind &&
    a.parentId === b.parentId &&
    (a.kind === 'into' ||
      (b.kind === 'gap' && a.beforeId === b.beforeId && a.depth === b.depth && a.anchorId === b.anchorId && a.side === b.side)))
