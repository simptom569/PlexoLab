// Перетаскивание карточек, колонок и плашек календаря. dnd-kit даёт захват указателя и «плавающую копию» (DragOverlay),
// а место заглушки (drop placeholder) определяется по тому, над чем сейчас указатель, как в макете (dragover):
//   карточка: над карточкой — перед ней или после (верхняя/нижняя половина), над колонкой — в конец;
//   колонка: над колонкой — перед ней или после (левая/правая половина), над «Добавить колонку» — в конец;
//   календарь: над днём.
// Разметка помечается атрибутами data-card-id, data-col-id, data-new-col, data-day.

import { useDraggable } from '@dnd-kit/core'
import { createContext, useCallback, useContext, useRef } from 'react'

/** Значение «в конец» для overCard и overSlot */
export const END = '__end'

export type DragKind = 'card' | 'col'

export interface DragState {
  kind: DragKind | null
  /** Переносимая задача или колонка */
  id: string | null
  /** Размер переносимого элемента: заглушка берёт его же */
  h: number
  w: number
  /** Колонка под указателем и карточка, перед которой встанет заглушка (или END) */
  overCol: string | null
  overCard: string | null
  /** Колонка, перед которой встанет заглушка колонки (или END) */
  overSlot: string | null
  /** День календаря под указателем */
  overDay: string | null
}

export const IDLE: DragState = { kind: null, id: null, h: 64, w: 272, overCol: null, overCard: null, overSlot: null, overDay: null }

export const DragContext = createContext<DragState>(IDLE)
export const useDragState = (): DragState => useContext(DragContext)

type Target = Pick<DragState, 'overCol' | 'overCard' | 'overSlot' | 'overDay'>

/** Что под указателем в точке (x, y) для переноса вида `kind`; null — указатель не над целью */
export function targetAt(prev: DragState, kind: DragKind, x: number, y: number): Target | null {
  const el = document.elementFromPoint(x, y)
  if (!el) return null
  const keep = (patch: Partial<Target>): Target => ({
    overCol: prev.overCol, overCard: prev.overCard, overSlot: prev.overSlot, overDay: prev.overDay, ...patch,
  })
  // над самой заглушкой: цель прежняя (в макете заглушка лежит внутри обёртки цели и тоже ловит бросок)
  if (el.closest('[data-ph]')) return keep({})

  if (kind === 'col') {
    if (el.closest('[data-new-col]')) return keep({ overSlot: END })
    const colEl = el.closest<HTMLElement>('[data-col-id]')
    if (!colEl) return null
    const cols = Array.from(document.querySelectorAll<HTMLElement>('[data-col-id]'))
    const rect = colEl.getBoundingClientRect()
    const past = x > rect.left + rect.width / 2
    const i = cols.indexOf(colEl)
    return keep({ overSlot: past ? (cols[i + 1]?.dataset.colId ?? END) : colEl.dataset.colId! })
  }

  const dayEl = el.closest<HTMLElement>('[data-day]')
  if (dayEl) return keep({ overDay: dayEl.dataset.day! })

  const colEl = el.closest<HTMLElement>('[data-col-id]')
  if (!colEl) return null
  const cardEl = el.closest<HTMLElement>('[data-card-id]')
  if (cardEl) {
    const rect = cardEl.getBoundingClientRect()
    const after = y > rect.top + rect.height / 2
    const cards = Array.from(colEl.querySelectorAll<HTMLElement>('[data-card-id]'))
    const i = cards.indexOf(cardEl)
    return keep({ overCol: colEl.dataset.colId!, overCard: after ? (cards[i + 1]?.dataset.cardId ?? END) : cardEl.dataset.cardId! })
  }
  // над колонкой, но не над карточкой: по умолчанию в конец, дальше уточняют карточки
  if (prev.overCol !== colEl.dataset.colId) return keep({ overCol: colEl.dataset.colId!, overCard: END })
  return keep({})
}

/** Данные, которые перетаскиваемый элемент отдаёт в событие переноса */
export interface DragData {
  kind: DragKind
  id: string
  /** Размер элемента в момент старта: заглушка берёт его же (rect.initial у dnd-kit в onDragStart ещё пуст) */
  measure: () => { width: number; height: number } | undefined
}

/** Источник переноса: ставит ref и обработчики указателя на элемент */
export function useDragSource(kind: DragKind, id: string) {
  const node = useRef<HTMLElement | null>(null)
  const { setNodeRef, listeners } = useDraggable({
    id: `${kind}:${id}`,
    data: { kind, id, measure: () => node.current?.getBoundingClientRect() } satisfies DragData,
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
