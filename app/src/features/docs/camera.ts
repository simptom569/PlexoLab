// Камера холста: какая часть бесконечного поля видна и в каком масштабе. Чистые функции, без React.
//
// Точка холста (wx, wy) показывается в точке окна (wx * z + x, wy * z + y), считая от левого верхнего угла холста
// (внутри рамки). В покое камера стоит на HOME: x = y = 0, z = 1, и холст выглядит как в макете.

export type Camera = { x: number; y: number; z: number }
export type Point = { x: number; y: number }
export type Size = { w: number; h: number }
export type Rect = { x: number; y: number; w: number; h: number }

export const HOME: Camera = { x: 0, y: 0, z: 1 }

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 2
/** Ступени масштаба для кнопок «−» и «+»: от нынешнего к ближайшей ступени в нужную сторону */
export const ZOOM_PRESETS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2] as const
/** Чувствительность колеса: один щелчок мыши (deltaY = 100) меняет масштаб примерно в 1,16 раза */
const WHEEL_ZOOM_RATE = 0.0015

/** Предел координат: тот же, что у сервера (MAX_COORD в domain/docs.rs) */
export const MAX_COORD = 100_000

/** Ближе скольки пикселей к краю окна указатель двигает холст сам, пока тащат объект */
export const EDGE_ZONE = 48
/** Скорость автопрокрутки у самого края, пикселей в секунду */
export const EDGE_SPEED = 900

/** Отступ от краёв окна у «Показать всё» */
const FIT_PADDING = 48

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

export const clampZoom = (z: number): number => clamp(z, MIN_ZOOM, MAX_ZOOM)
export const clampCoord = (v: number): number => clamp(v, -MAX_COORD, MAX_COORD)

/** Положение, округлённое до сотых: на сервер уходят аккуратные числа, а не хвосты дробей */
export const tidy = (v: number): number => Math.round(v * 100) / 100

export const toWorld = (c: Camera, screen: Point): Point => ({ x: (screen.x - c.x) / c.z, y: (screen.y - c.y) / c.z })
export const toScreen = (c: Camera, world: Point): Point => ({ x: world.x * c.z + c.x, y: world.y * c.z + c.y })

/**
 * Сдвиг в целые пиксели: текст при дробном сдвиге на 100% становится мутным. Погрешность до полпикселя не видна и не
 * накапливается: следующая камера считается от точки, а не от прошлой камеры.
 */
export const snap = (c: Camera): Camera => ({ x: Math.round(c.x), y: Math.round(c.y), z: c.z })

export const panBy = (c: Camera, dx: number, dy: number): Camera => ({ ...c, x: c.x + dx, y: c.y + dy })

/** Масштаб до `z` (в пределах от MIN_ZOOM до MAX_ZOOM) так, чтобы точка `at` окна осталась над той же точкой холста */
export function zoomTo(c: Camera, z: number, at: Point): Camera {
  const next = clampZoom(z)
  if (next === c.z) return c
  const world = toWorld(c, at)
  return { z: next, x: at.x - world.x * next, y: at.y - world.y * next }
}

/** То же, но во столько-то раз от нынешнего масштаба */
export const zoomBy = (c: Camera, factor: number, at: Point): Camera => zoomTo(c, c.z * factor, at)

/** Ближайшая ступень масштаба выше (`up`) или ниже нынешнего; на краю остаётся тот же масштаб */
export function nextZoom(z: number, up: boolean): number {
  const eps = 1e-6
  if (up) return ZOOM_PRESETS.find((p) => p > z + eps) ?? z
  return [...ZOOM_PRESETS].reverse().find((p) => p < z - eps) ?? z
}

/** Во сколько раз колесо с прокруткой `deltaY` меняет масштаб: вперёд (deltaY < 0) приближает, назад отдаляет */
export const wheelZoomFactor = (deltaY: number): number => Math.exp(-deltaY * WHEEL_ZOOM_RATE)

type WheelLike = { deltaX: number; deltaY: number; deltaMode: number; shiftKey: boolean }

/**
 * На сколько пикселей колесо или тачпад двигают камеру. `deltaMode` бывает в пикселях, строках и страницах; с Shift
 * вертикальное колесо двигает по горизонтали. Вниз по колесу (deltaY > 0) содержимое уезжает вверх.
 */
export function wheelPan(e: WheelLike, view: Size): Point {
  const line = e.deltaMode === 1
  const page = e.deltaMode === 2
  let dx = e.deltaX * (line ? 16 : page ? view.w : 1)
  let dy = e.deltaY * (line ? 16 : page ? view.h : 1)
  if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0]
  // -0 из умножения не нужен: в сравнениях и тестах он ведёт себя как лишний случай
  return { x: dx === 0 ? 0 : -dx, y: dy === 0 ? 0 : -dy }
}

/** Скорость автопрокрутки по одной оси: `p` — положение указателя от начала окна, `size` — размер окна */
function edgeAxis(p: number, size: number): number {
  if (p < EDGE_ZONE) return Math.min(1, (EDGE_ZONE - p) / EDGE_ZONE) * EDGE_SPEED
  if (p > size - EDGE_ZONE) return -Math.min(1, (p - (size - EDGE_ZONE)) / EDGE_ZONE) * EDGE_SPEED
  return 0
}

/**
 * Куда и как быстро холст едет сам, пока объект тащат у края окна (пикселей в секунду, это сдвиг камеры):
 * у левого края содержимое едет вправо, у правого влево. Чем ближе к краю, тем быстрее; за краем скорость наибольшая.
 */
export function edgeVelocity(pointer: Point, view: Size): Point {
  return { x: edgeAxis(pointer.x, view.w), y: edgeAxis(pointer.y, view.h) }
}

/** Какая часть холста видна: прямоугольник в координатах холста */
export function visibleRect(c: Camera, view: Size): Rect {
  const topLeft = toWorld(c, { x: 0, y: 0 })
  return { x: topLeft.x, y: topLeft.y, w: view.w / c.z, h: view.h / c.z }
}

/** Целиком ли `inner` лежит внутри `outer` */
export const contains = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h

/** Пересекаются ли два прямоугольника (касание краем не считается) */
export const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Камера, при которой `bounds` целиком в окне по центру; не крупнее 100%, чтобы маленькая схема не раздувалась */
export function fitCamera(bounds: Rect, view: Size): Camera {
  const w = Math.max(bounds.w, 1)
  const h = Math.max(bounds.h, 1)
  const z = clampZoom(Math.min((view.w - 2 * FIT_PADDING) / w, (view.h - 2 * FIT_PADDING) / h, 1))
  return snap({ z, x: (view.w - w * z) / 2 - bounds.x * z, y: (view.h - h * z) / 2 - bounds.y * z })
}

/**
 * Камера, сдвинутая на минимум так, чтобы `box` (в пикселях окна) целиком помещался в окне с отступом `margin`; если он
 * больше окна, прижимается левым и верхним краем. Нужна, когда по Tab выбирают объект, которого сейчас не видно.
 */
export function revealCamera(c: Camera, box: Rect, view: Size, margin = 24): Camera {
  const shift = (start: number, size: number, limit: number): number => {
    if (start < margin) return margin - start
    if (start + size > limit - margin) return Math.max(limit - margin - (start + size), margin - start)
    return 0
  }
  const dx = shift(box.x, box.w, view.w)
  const dy = shift(box.y, box.h, view.h)
  return dx === 0 && dy === 0 ? c : snap(panBy(c, dx, dy))
}

/** Вид сетки точек на фоне: шаг и сдвиг. На малом масштабе точки редеют вдвое, чтобы не сливаться в серую муть. */
export function gridStyle(c: Camera): { size: number; x: number; y: number } {
  let size = 22 * c.z
  while (size < 12) size *= 2
  return { size, x: c.x, y: c.y }
}
