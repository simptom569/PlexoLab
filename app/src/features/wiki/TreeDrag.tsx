// Перетаскивание страниц по дереву. dnd-kit даёт захват указателя и «плавающую копию» (DragOverlay), а место падения
// определяется по тому, над чем сейчас указатель, так же, как у задач (см. features/board/dnd.ts): строки дерева помечены
// `data-tree-id`, само дерево `data-tree-area`. Что значит место на строке, решает treeDrop.ts.

import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragStartEvent } from '@dnd-kit/core'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { WikiNode } from '../../lib/api/types'
import { useReadOnly } from '../../lib/link'
import { usePointer } from '../../lib/usePointer'
import type { TreeRow } from './logic'
import { IDLE, TreeDragContext, type DragData, type TreeDragState } from './treeDragState'
import { levelAt, resolveDrop, sameDrop, type Drop, type Hover } from './treeDrop'

/** Над самой заглушкой цель прежняя (она лежит среди строк и тоже ловит бросок) */
const KEEP = 'keep'

/** Что под указателем в точке (x, y); null — не над деревом */
function hoverAt(x: number, y: number): Hover | typeof KEEP | null {
  const el = document.elementFromPoint(x, y)
  if (!el) return null
  if (el.closest('[data-ph]')) return KEEP
  const rowEl = el.closest<HTMLElement>('[data-tree-id]')
  if (rowEl) {
    const rect = rowEl.getBoundingClientRect()
    return { overId: rowEl.dataset.treeId!, fy: (y - rect.top) / rect.height, level: levelAt(x, rect.left) }
  }
  // ниже последней строки, но в рамке дерева: в конец
  const area = el.closest('[data-tree-area]')
  if (!area) return null
  const rows = area.querySelectorAll<HTMLElement>('[data-tree-id]')
  const last = rows[rows.length - 1]?.getBoundingClientRect()
  return last && y > last.bottom ? { overId: null, fy: 1, level: levelAt(x, last.left) } : null
}

type ProviderProps = {
  /** Страницы в порядке дерева и видимые строки (без поиска) */
  pages: WikiNode[]
  rows: TreeRow[]
  /** Бросок на место; не вызывается, если места нет или страница осталась на месте */
  onMove: (id: string, drop: Drop) => void
  /** Копия под указателем */
  renderOverlay: (id: string, width: number) => ReactNode
  children: ReactNode
}

export function TreeDragProvider({ pages, rows, onMove, renderOverlay, children }: ProviderProps) {
  const [state, setState] = useState<TreeDragState>(IDLE)
  const ref = useRef<TreeDragState>(IDLE)
  // обработчики dnd-kit живут дольше одной отрисовки: свежие страницы и строки берём из ссылки
  const latest = useRef({ pages, rows, onMove })
  useEffect(() => {
    latest.current = { pages, rows, onMove }
  })
  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  // пока нет связи, переносить нельзя (lib/link.ts): без датчиков страницу не поднять
  const locked = useReadOnly()
  const sensors = useSensors(...(locked ? [] : [pointerSensor]))
  const pointer = usePointer()

  const set = useCallback((next: TreeDragState) => {
    ref.current = next
    setState(next)
  }, [])

  // пока тащим, текст на странице не выделяется
  const dragging = state.id !== null
  useEffect(() => {
    if (!dragging) return
    const prev = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.userSelect = prev
    }
  }, [dragging])

  const dropAt = (cur: TreeDragState, p: { x: number; y: number }): Drop | null | typeof KEEP => {
    const hover = hoverAt(p.x, p.y)
    if (hover === KEEP) return KEEP
    if (!hover || !cur.id) return null
    return resolveDrop(latest.current.pages, latest.current.rows, cur.id, hover)
  }

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as DragData
    const rect = data.measure()
    set({ id: data.id, h: Math.round(rect?.height ?? IDLE.h), w: Math.round(rect?.width ?? IDLE.w), drop: null })
  }

  const onDragMove = () => {
    const cur = ref.current
    const p = pointer()
    if (!cur.id || !p) return
    const drop = dropAt(cur, p)
    if (drop === KEEP || sameDrop(drop, cur.drop)) return
    set({ ...cur, drop })
  }

  const onDragEnd = () => {
    const cur = ref.current
    const p = pointer()
    // бросок засчитывается по месту под указателем в момент отпускания; над заглушкой — по последнему известному
    const found = cur.id && p ? dropAt(cur, p) : null
    const drop = found === KEEP ? cur.drop : found
    set(IDLE)
    if (cur.id && drop) latest.current.onMove(cur.id, drop)
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={() => set(IDLE)}
      accessibility={{ announcements: { onDragStart: () => undefined, onDragOver: () => undefined, onDragEnd: () => undefined, onDragCancel: () => undefined } }}
    >
      <TreeDragContext.Provider value={state}>{children}</TreeDragContext.Provider>
      <DragOverlay dropAnimation={null} className="drag-overlay" style={{ pointerEvents: 'none' }}>
        {state.id ? renderOverlay(state.id, state.w) : null}
      </DragOverlay>
    </DndContext>
  )
}
