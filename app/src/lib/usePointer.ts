import { useCallback, useEffect, useRef } from 'react'

export type Point = { x: number; y: number }

const EVENTS = ['pointerdown', 'pointermove', 'pointerup'] as const

/**
 * Где сейчас указатель (clientX/clientY), для переносов на dnd-kit. «Точка нажатия + delta» из событий dnd-kit для этого
 * не годится: delta включает прокрутку контейнеров (в dnd-kit это scrollAdjustedTranslate), и пока доска или страница
 * прокручиваются сами, точка уезжает от указателя на величину прокрутки.
 *
 * Слушаем окно в фазе перехвата: ни один обработчик ниже (даже с stopPropagation, как у кнопок в шапке колонки) не может
 * скрыть событие, а к началу переноса последнее нажатие уже записано. Пока страница прокручивается под неподвижным
 * указателем, событий нет и точка не меняется, а dnd-kit присылает onDragMove на каждый шаг прокрутки: цель
 * пересчитывается по той же точке, но уже над новым содержимым.
 */
export function usePointer(): () => Point | null {
  const last = useRef<Point | null>(null)
  useEffect(() => {
    const remember = (e: PointerEvent) => {
      last.current = { x: e.clientX, y: e.clientY }
    }
    for (const name of EVENTS) window.addEventListener(name, remember, { capture: true, passive: true })
    return () => {
      for (const name of EVENTS) window.removeEventListener(name, remember, { capture: true })
    }
  }, [])
  return useCallback(() => last.current, [])
}
