import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  HOME, fitCamera, intersects, nextZoom, panBy, visibleRect, wheelPan, wheelZoomFactor, zoomBy, zoomTo,
  type Camera, type Point, type Rect, type Size,
} from './camera'
import { rememberView, rememberedView } from './views'

/** Через сколько после последнего движения камеры запоминается вид документа */
const REMEMBER_DELAY_MS = 400

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
 * Камера холста и всё, что с ней связано: где она сейчас, перевод координат окна в координаты холста, прокрутка и масштаб
 * колесом, кнопки масштаба, запоминание вида документа на этом компьютере.
 *
 * `edge`: холст включён (в режиме «Страница» камеры нет). `getBounds`: всё, что лежит на холсте, для «Показать всё» и
 * проверки запомненного вида. Камера лежит и в состоянии (для отрисовки), и в ссылке: обработчики событий, которые
 * приходят чаще отрисовки, читают свежую.
 */
export function useCanvasView(edge: boolean, docId: string, getBounds: () => Rect) {
  const cvRef = useRef<HTMLDivElement>(null)
  const [initial] = useState<Camera>(() => rememberedView(docId) ?? HOME)
  const [cam, setCam] = useState<Camera>(initial)
  const camRef = useRef<Camera>(initial)
  const boundsRef = useRef(getBounds)
  useLayoutEffect(() => {
    boundsRef.current = getBounds
  })

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

  // Запомненный вид, который уже ничего не показывает (содержимое убрали или сдвинули на другом компьютере), не нужен:
  // холст начинается с начала. Проверяем один раз, когда холст впервые появился, до первой отрисовки.
  const checked = useRef(false)
  useLayoutEffect(() => {
    if (!edge || checked.current) return
    checked.current = true
    const c = camRef.current
    if (c !== HOME && !intersects(visibleRect(c, viewSize()), boundsRef.current())) setCamera(HOME)
  }, [edge, viewSize, setCamera])

  // Вид запоминается через паузу после последнего движения, а при уходе из документа сразу
  useEffect(() => {
    if (!edge) return
    const timer = setTimeout(() => rememberView(docId, cam), REMEMBER_DELAY_MS)
    return () => clearTimeout(timer)
  }, [cam, edge, docId])
  useEffect(() => () => rememberView(docId, camRef.current), [docId])

  // Колесо над холстом двигает его, а с Ctrl меняет масштаб вокруг указателя (так же приходит щипок на тачпаде). Обработчик
  // свой, не из React: у onWheel React он пассивный, и preventDefault не работает.
  useEffect(() => {
    const el = cvRef.current
    if (!el || !edge) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault()
        const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1)
        setCamera(zoomBy(camRef.current, wheelZoomFactor(delta), screenOf(e.clientX, e.clientY)))
        return
      }
      if (scrollsInside(e.target, el, e.deltaX, e.deltaY)) return
      e.preventDefault()
      const d = wheelPan(e, viewSize())
      if (d.x !== 0 || d.y !== 0) setCamera(panBy(camRef.current, d.x, d.y))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [edge, setCamera, viewSize, screenOf])

  const centre = useCallback((): Point => {
    const view = viewSize()
    return { x: view.w / 2, y: view.h / 2 }
  }, [viewSize])

  /** Кнопки «−» и «+»: на ступень вокруг середины окна */
  const zoomStep = useCallback(
    (up: boolean) => setCamera(zoomTo(camRef.current, nextZoom(camRef.current.z, up), centre())),
    [centre, setCamera],
  )
  /** «100%»: вернуть масштаб вокруг середины окна */
  const resetZoom = useCallback(() => setCamera(zoomTo(camRef.current, 1, centre())), [centre, setCamera])
  /** «Показать всё»: всё содержимое целиком в окне */
  const showAll = useCallback(() => setCamera(fitCamera(boundsRef.current(), viewSize())), [setCamera, viewSize])

  return { cvRef, cam, camRef, setCamera, viewSize, screenOf, zoomStep, resetZoom, showAll }
}
