// Состояние переноса страницы по дереву и источник переноса для строки (используются TreeDrag.tsx и WikiTree.tsx).

import { useDraggable } from '@dnd-kit/core'
import { createContext, useCallback, useContext, useRef } from 'react'
import type { Drop } from './treeDrop'

export type TreeDragState = {
  /** Переносимая страница */
  id: string | null
  /** Размер её строки: заглушка берёт его же */
  h: number
  w: number
  /** Куда упадёт сейчас; null — никуда */
  drop: Drop | null
}

export const IDLE: TreeDragState = { id: null, h: 32, w: 220, drop: null }

export const TreeDragContext = createContext<TreeDragState>(IDLE)
export const useTreeDrag = (): TreeDragState => useContext(TreeDragContext)

/** Данные, которые строка отдаёт в событие переноса */
export type DragData = { id: string; measure: () => { width: number; height: number } | undefined }

/** Источник переноса: ref и обработчики указателя на строку дерева. `disabled` — например, пока идёт поиск. */
export function useTreeDragSource(id: string, disabled: boolean) {
  const node = useRef<HTMLElement | null>(null)
  const { setNodeRef, listeners } = useDraggable({
    id: `page:${id}`,
    disabled,
    data: { id, measure: () => node.current?.getBoundingClientRect() } satisfies DragData,
  })
  const ref = useCallback(
    (el: HTMLElement | null) => {
      node.current = el
      setNodeRef(el)
    },
    [setNodeRef],
  )
  return { ref, handlers: listeners }
}
