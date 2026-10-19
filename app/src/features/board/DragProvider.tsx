import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragMoveEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { DragContext, IDLE, targetAt, type DragData, type DragKind, type DragState } from './dnd'

interface ProviderProps {
  /** Бросок на цель; не вызывается, если указатель отпустили не над целью */
  onDrop: (state: DragState) => void
  /** Что показывать под указателем: копия карточки, колонки или плашки */
  renderOverlay: (kind: DragKind, id: string) => ReactNode
  children: ReactNode
}

export function DragProvider({ onDrop, renderOverlay, children }: ProviderProps) {
  const [state, setState] = useState<DragState>(IDLE)
  const ref = useRef<DragState>(IDLE)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const set = useCallback((next: DragState) => {
    ref.current = next
    setState(next)
  }, [])

  // пока тащим, текст на странице не выделяется
  useEffect(() => {
    if (!state.kind) return
    const prev = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.userSelect = prev
    }
  }, [state.kind])

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as DragData
    const rect = data.measure()
    set({ ...IDLE, kind: data.kind, id: data.id, h: Math.round(rect?.height ?? IDLE.h), w: Math.round(rect?.width ?? IDLE.w) })
  }

  const pointer = (e: DragMoveEvent | DragEndEvent): { x: number; y: number } | null => {
    const start = e.activatorEvent as PointerEvent | undefined
    return start && 'clientX' in start ? { x: start.clientX + e.delta.x, y: start.clientY + e.delta.y } : null
  }

  const onDragMove = (e: DragMoveEvent) => {
    const cur = ref.current
    const p = pointer(e)
    if (!cur.kind || !p) return
    const target = targetAt(cur, cur.kind, p.x, p.y)
    if (!target) return
    if (target.overCol !== cur.overCol || target.overCard !== cur.overCard || target.overSlot !== cur.overSlot || target.overDay !== cur.overDay) {
      set({ ...cur, ...target })
    }
  }

  const onDragEnd = (e: DragEndEvent) => {
    const cur = ref.current
    const p = pointer(e)
    // бросок засчитывается, только если указатель над целью
    const over = cur.kind && p ? targetAt(cur, cur.kind, p.x, p.y) : null
    set(IDLE)
    if (over && cur.kind) onDrop({ ...cur, ...over })
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
      <DragContext.Provider value={state}>{children}</DragContext.Provider>
      <DragOverlay dropAnimation={null} className="drag-overlay" style={{ pointerEvents: 'none' }}>
        {state.kind && state.id ? renderOverlay(state.kind, state.id) : null}
      </DragOverlay>
    </DndContext>
  )
}
