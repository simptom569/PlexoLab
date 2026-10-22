import { useCallback, useEffect, useRef, useState } from 'react'
import { HOME, panBy, wheelPan, type Camera, type Point, type Size } from './camera'

/**
 * Есть ли под указателем внутри холста блок со своей прокруткой (широкий код или таблица в карточке с текстом), которому
 * есть куда крутиться в эту сторону: тогда колесо крутит его, а не двигает весь холст.
 */
function scrollsInside(target: EventTarget | null, boundary: HTMLElement, dx: number, dy: number): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== boundary; el = el.parentElement) {
    if (!(el instanceof HTMLElement)) continue
    const style = getComputedStyle(el)
    const room = (overflow: string, pos: number, client: number, full: number, delta: number): boolean =>
      /auto|scroll/.test(overflow) && full > client + 1 && (delta > 0 ? pos + client < full - 1 : delta < 0 && pos > 0)
    if (room(style.overflowY, el.scrollTop, el.clientHeight, el.scrollHeight, dy)) return true
    if (room(style.overflowX, el.scrollLeft, el.clientWidth, el.scrollWidth, dx)) return true
  }
  return false
}

/**
 * Камера холста и всё, что с ней связано: где она сейчас, перевод координат окна в координаты холста, прокрутка колесом.
 * `edge`: холст включён (в режиме «Страница» камеры нет). Камера лежит и в состоянии (для отрисовки), и в ссылке: обработчики
 * событий, которые приходят чаще отрисовки, читают свежую.
 */
export function useCanvasView(edge: boolean, initial: Camera = HOME) {
  const cvRef = useRef<HTMLDivElement>(null)
  const [cam, setCam] = useState<Camera>(initial)
  const camRef = useRef<Camera>(initial)

  const setCamera = useCallback((next: Camera) => {
    camRef.current = next
    setCam(next)
  }, [])

  /** Размер окна холста: внутри рамки, без неё */
  const viewSize = useCallback((): Size => {
    const el = cvRef.current
    return el ? { w: el.clientWidth, h: el.clientHeight } : { w: 0, h: 0 }
  }, [])

  /** Точка окна холста (от левого верхнего угла внутри рамки) по координатам указателя на экране */
  const screenOf = useCallback((clientX: number, clientY: number): Point => {
    const el = cvRef.current
    if (!el) return { x: clientX, y: clientY }
    const box = el.getBoundingClientRect()
    return { x: clientX - box.left - el.clientLeft, y: clientY - box.top - el.clientTop }
  }, [])

  // Колесо над холстом двигает его, а не страницу. Обработчик свой, не из React: у onWheel React он пассивный, и
  // preventDefault не работает.
  useEffect(() => {
    const el = cvRef.current
    if (!el || !edge) return
    const onWheel = (e: WheelEvent) => {
      // с Ctrl колесо отдано под масштаб; пока он не включён, оно просто не должно листать страницу
      if (e.ctrlKey) {
        e.preventDefault()
        return
      }
      if (scrollsInside(e.target, el, e.deltaX, e.deltaY)) return
      e.preventDefault()
      const d = wheelPan(e, viewSize())
      if (d.x !== 0 || d.y !== 0) setCamera(panBy(camRef.current, d.x, d.y))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [edge, setCamera, viewSize])

  return { cvRef, cam, camRef, setCamera, viewSize, screenOf }
}
