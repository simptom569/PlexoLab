// Холст без React: объекты, стрелки, положение карточки с текстом. Порт vDocs, wbDown, noteDown и wbLink макета.
// Все функции чистые: берут состояние холста и возвращают новое.

import type { CanvasLink, CanvasObject, ObjectKind } from '../../lib/api/types'
import { MAX_COORD, contains, type Rect } from './camera'

/** Положение и ширина карточки с текстом документа (note в макете) */
export type Note = { x: number; y: number; w: number }

export type CanvasState = { note: Note; objects: CanvasObject[]; links: CanvasLink[] }

/** Кнопки «+ Стикер», «+ Фигура», «+ Овал», «+ Текст» в нижней панели (wbTools) */
export const OBJECT_TOOLS: ReadonlyArray<{ kind: ObjectKind; label: string }> = [
  { kind: 'sticky', label: 'Стикер' },
  { kind: 'rect', label: 'Фигура' },
  { kind: 'ellipse', label: 'Овал' },
  { kind: 'text', label: 'Текст' },
]

/** Ширина и высота нового объекта (dims в макете) */
export const DIMS: Record<ObjectKind, readonly [number, number]> = {
  sticky: [190, 120],
  rect: [160, 80],
  ellipse: [160, 90],
  text: [200, 40],
}

/** Индекс цвета нового объекта в палитре (defColor в макете) */
export const DEFAULT_COLOR: Record<ObjectKind, number> = { sticky: 6, rect: 3, ellipse: 5, text: 0 }

/**
 * Новый объект: справа от карточки с текстом, каждый следующий со сдвигом (по кругу через шесть).
 * Если `view` (видимая часть холста) задана и там это место не видно целиком, объект встаёт в центр видимой части с тем
 * же сдвигом: иначе после прокрутки или масштаба он появился бы за краем окна.
 * Идентификатор выдаёт вызывающий.
 */
export function newObject(state: CanvasState, kind: ObjectKind, id: string, view?: Rect): CanvasObject {
  const n = state.objects.length
  const shift = (n % 6) * 26
  const [w, h] = DIMS[kind]
  let x = state.note.x + state.note.w + 40 + shift
  let y = 60 + shift
  if (view && !contains(view, { x, y, w, h })) {
    x = Math.round(view.x + (view.w - w) / 2) + shift
    y = Math.round(view.y + (view.h - h) / 2) + shift
  }
  return { id, type: kind, x: clamp(x), y: clamp(y), w, h, text: '', color: DEFAULT_COLOR[kind] }
}

const clamp = (v: number): number => Math.min(MAX_COORD, Math.max(-MAX_COORD, v))

export const addObject = (state: CanvasState, object: CanvasObject): CanvasState => ({ ...state, objects: [...state.objects, object] })

type ObjectPatch = Partial<Pick<CanvasObject, 'x' | 'y' | 'text' | 'color'>>

export const patchObject = (state: CanvasState, id: string, patch: ObjectPatch): CanvasState => ({
  ...state,
  objects: state.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)),
})

/** Объект исчезает вместе со всеми стрелками, которые к нему вели */
export const removeObject = (state: CanvasState, id: string): CanvasState => ({
  ...state,
  objects: state.objects.filter((o) => o.id !== id),
  links: state.links.filter((l) => l.a !== id && l.b !== id),
})

export const moveNote = (state: CanvasState, x: number, y: number): CanvasState => ({ ...state, note: { ...state.note, x, y } })

/** Связь двух объектов; повторная связь той же пары, в любую сторону, убирает стрелку (wbLink в макете) */
export function toggleLink(state: CanvasState, from: string, to: string): CanvasState {
  const same = (l: CanvasLink) => (l.a === from && l.b === to) || (l.a === to && l.b === from)
  return { ...state, links: state.links.some(same) ? state.links.filter((l) => !same(l)) : [...state.links, { a: from, b: to }] }
}

type Box = Pick<CanvasObject, 'x' | 'y' | 'w' | 'h'>

/** Повёрнутый `div`, который рисует стрелку: левый край, верхний край, длина и угол в градусах */
export type Line = { x: number; y: number; len: number; ang: number }

/** Во сколько раз надо пройти от центра по направлению (dx, dy), чтобы дойти до границы прямоугольника */
const border = (it: Box, dx: number, dy: number): number =>
  Math.min(dx !== 0 ? it.w / 2 / Math.abs(dx) : Infinity, dy !== 0 ? it.h / 2 / Math.abs(dy) : Infinity)

/**
 * Линия от границы одного объекта до границы другого. Если объекты пересекаются или касаются, стрелки нет (null).
 * Границей считается прямоугольник объекта, у овала тоже.
 */
export function linkLine(a: Box, b: Box): Line | null {
  const ax = a.x + a.w / 2
  const ay = a.y + a.h / 2
  const bx = b.x + b.w / 2
  const by = b.y + b.h / 2
  const dx = bx - ax
  const dy = by - ay
  const fa = border(a, dx, dy)
  const fb = border(b, dx, dy)
  if (fa + fb >= 1) return null
  const sx = ax + dx * fa
  const sy = ay + dy * fa
  const ex = bx - dx * fb
  const ey = by - dy * fb
  return { x: sx, y: sy - 1, len: Math.hypot(ex - sx, ey - sy), ang: (Math.atan2(ey - sy, ex - sx) * 180) / Math.PI }
}

/** Стрелки, которые видно: те, чьи объекты есть на холсте и не пересекаются */
export function canvasLines(state: CanvasState): Line[] {
  const byId = new Map(state.objects.map((o) => [o.id, o]))
  const lines: Line[] = []
  for (const l of state.links) {
    const a = byId.get(l.a)
    const b = byId.get(l.b)
    const line = a && b ? linkLine(a, b) : null
    if (line) lines.push(line)
  }
  return lines
}

/** Всё, что лежит на холсте: карточка с текстом (её высоту знает только страница) и все объекты */
export function canvasBounds(state: CanvasState, noteHeight: number): Rect {
  const boxes: Rect[] = [
    { x: state.note.x, y: state.note.y, w: state.note.w, h: noteHeight },
    ...state.objects.map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h })),
  ]
  const left = Math.min(...boxes.map((b) => b.x))
  const top = Math.min(...boxes.map((b) => b.y))
  const right = Math.max(...boxes.map((b) => b.x + b.w))
  const bottom = Math.max(...boxes.map((b) => b.y + b.h))
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/** Совпадают ли два холста (порядок объектов важен: это слои; порядок стрелок нет) */
export function sameCanvas(a: CanvasState, b: CanvasState): boolean {
  if (a === b) return true
  if (a.note.x !== b.note.x || a.note.y !== b.note.y || a.note.w !== b.note.w) return false
  if (a.objects.length !== b.objects.length || a.links.length !== b.links.length) return false
  const same = a.objects.every((o, i) => {
    const p = b.objects[i]!
    return o.id === p.id && o.type === p.type && o.x === p.x && o.y === p.y && o.w === p.w && o.h === p.h && o.text === p.text && o.color === p.color
  })
  return same && a.links.every((l) => b.links.some((m) => m.a === l.a && m.b === l.b))
}
