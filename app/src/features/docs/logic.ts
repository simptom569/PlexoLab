// Документы без React: миниатюра холста, подписи карточки, порядок в списке. Порт vDocs макета.

import type { DocMode, DocSummary } from '../../lib/api/types'
import { plural } from '../../lib/date'
import { toneAt } from '../../lib/tones'

// ----- Карточка списка -----

/** Во сколько раз миниатюра меньше холста (sc в макете) */
export const THUMB_SCALE = 0.2
/** Высота карточки с текстом в миниатюре, пикселей холста: настоящая зависит от текста, на миниатюре она одна */
const THUMB_NOTE_H = 150

/** Прямоугольник миниатюры: левый и верхний край, размер, фон и рамка */
export type ThumbBox = { l: number; t: number; w: number; h: number; bg: string; bd: string }

/** Миниатюра есть у документа-холста, на котором что-то лежит; у остальных в карточке фрагмент текста */
export const hasThumb = (d: Pick<DocSummary, 'mode' | 'object_count'>): boolean => d.mode === 'edge' && d.object_count > 0

/** Карточка с текстом первой, потом объекты холста. Объекты меньше 6×4 пикселей увеличиваются до них. */
export function thumbBoxes(d: Pick<DocSummary, 'note' | 'thumb'>): ThumbBox[] {
  const sc = THUMB_SCALE
  return [
    { l: d.note.x * sc, t: d.note.y * sc, w: d.note.w * sc, h: THUMB_NOTE_H * sc, bg: 'var(--surface2)', bd: 'var(--line-strong)' },
    ...d.thumb.map((it) => {
      const text = it.type === 'text'
      const tone = toneAt(it.color)
      return {
        l: it.x * sc,
        t: it.y * sc,
        w: Math.max(6, it.w * sc),
        h: Math.max(4, it.h * sc),
        bg: text ? 'var(--line-strong)' : tone.bg,
        bd: text ? 'transparent' : tone.fg,
      }
    }),
  ]
}

export const docTitle = (title: string): string => title || 'Без названия'

/** Фрагмент текста; у пустого документа надпись (серверный фрагмент тогда пустой) */
export const snippetText = (d: Pick<DocSummary, 'snippet'>): string => d.snippet || 'Пустой документ'

export const modeLabel = (mode: DocMode): string => (mode === 'edge' ? 'Холст' : 'Страница')

/** «3 объекта на холсте» или «Без холста» */
export const objectsLabel = (count: number): string =>
  count > 0 ? `${count} ${plural(count, 'объект', 'объекта', 'объектов')} на холсте` : 'Без холста'

export const starLabel = (starred: boolean): string => (starred ? 'Убрать из избранного' : 'В избранное')

// ----- Порядок -----

/** Список после переноса: документ перед `beforeId` (null — последним) */
export function moveDoc<T extends { id: string }>(list: T[], id: string, beforeId: string | null): T[] {
  const doc = list.find((d) => d.id === id)
  if (!doc) return list
  const rest = list.filter((d) => d.id !== id)
  const at = beforeId ? rest.findIndex((d) => d.id === beforeId) : -1
  return at < 0 ? [...rest, doc] : [...rest.slice(0, at), doc, ...rest.slice(at)]
}

/**
 * Список в том порядке, который задаёт `order` (идентификаторы всех документов): так перенос применяется и к списку
 * с поиском, где видна только часть документов. Неизвестные в `order` остаются в конце в прежнем порядке.
 */
export function sortLike<T extends { id: string }>(list: T[], order: string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]))
  return list
    .map((d, i) => ({ d, i }))
    .sort((a, b) => (rank.get(a.d.id) ?? Infinity) - (rank.get(b.d.id) ?? Infinity) || a.i - b.i)
    .map((x) => x.d)
}

/**
 * Перед каким документом встанет перенесённый, если его бросили перед видимым `over` (null — в конец видимого списка).
 * `full` — все документы в порядке списка, `visible` — те, что видны сейчас (поиск, «Избранные»).
 * Возвращает идентификатор, `null` («в самый конец») или `undefined`, если документ остаётся на месте.
 */
export function beforeFor(full: string[], visible: string[], dragId: string, over: string | null): string | null | undefined {
  if (over === dragId) return undefined
  // сосед справа в том, что видно: бросок перед ним — это то же самое место
  const at = visible.indexOf(dragId)
  const next = at >= 0 ? (visible[at + 1] ?? null) : undefined
  if (over === next) return undefined
  if (over !== null) return over
  // в конец видимого: перед тем, кто идёт в полном порядке за последним видимым (скрытые остаются позади него)
  const last = visible.filter((id) => id !== dragId).at(-1)
  if (!last) return undefined
  const rest = full.filter((id) => id !== dragId)
  return rest[rest.indexOf(last) + 1] ?? null
}
