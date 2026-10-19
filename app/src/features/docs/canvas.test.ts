import { describe, expect, it } from 'vitest'
import type { CanvasObject } from '../../lib/api/types'
import {
  addObject, canvasLines, linkLine, moveNote, newObject, patchObject, removeObject, sameCanvas, toggleLink, type CanvasState,
} from './canvas'

const obj = (id: string, x: number, y: number, w = 100, h = 60, type: CanvasObject['type'] = 'rect'): CanvasObject => ({
  id, type, x, y, w, h, text: id, color: 3,
})

const base = (objects: CanvasObject[] = [], links: CanvasState['links'] = []): CanvasState => ({
  note: { x: 24, y: 28, w: 400 },
  objects,
  links,
})

describe('newObject', () => {
  it('появляется справа от карточки с текстом, размер и цвет по виду', () => {
    expect(newObject(base(), 'sticky', 'n1')).toEqual({ id: 'n1', type: 'sticky', x: 464, y: 60, w: 190, h: 120, text: '', color: 6 })
    expect(newObject(base(), 'rect', 'n1')).toMatchObject({ w: 160, h: 80, color: 3 })
    expect(newObject(base(), 'ellipse', 'n1')).toMatchObject({ w: 160, h: 90, color: 5 })
    expect(newObject(base(), 'text', 'n1')).toMatchObject({ w: 200, h: 40, color: 0 })
  })

  it('каждый следующий со сдвигом 26, после шести по кругу', () => {
    const at = (n: number) => newObject(base(Array.from({ length: n }, (_, i) => obj(`o${i}`, 0, 0))), 'rect', 'n')
    expect(at(1)).toMatchObject({ x: 490, y: 86 })
    expect(at(5)).toMatchObject({ x: 464 + 5 * 26, y: 60 + 5 * 26 })
    expect(at(6)).toMatchObject({ x: 464, y: 60 })
    expect(at(7)).toMatchObject({ x: 490, y: 86 })
  })

  it('учитывает положение и ширину карточки', () => {
    const s: CanvasState = { ...base(), note: { x: 100, y: 10, w: 500 } }
    expect(newObject(s, 'rect', 'n').x).toBe(100 + 500 + 40)
  })
})

describe('правки объектов', () => {
  it('добавление кладёт объект поверх остальных', () => {
    const s = addObject(base([obj('a', 0, 0)]), obj('b', 5, 5))
    expect(s.objects.map((o) => o.id)).toEqual(['a', 'b'])
  })

  it('patchObject меняет только выбранный и не трогает исходное состояние', () => {
    const s = base([obj('a', 0, 0), obj('b', 5, 5)])
    const next = patchObject(s, 'b', { x: 50, text: 'Новый', color: 7 })
    expect(next.objects[1]).toMatchObject({ x: 50, y: 5, text: 'Новый', color: 7 })
    expect(next.objects[0]).toBe(s.objects[0])
    expect(s.objects[1]!.x).toBe(5)
  })

  it('удаление объекта убирает и его стрелки', () => {
    const s = base([obj('a', 0, 0), obj('b', 300, 0), obj('c', 600, 0)], [{ a: 'a', b: 'b' }, { a: 'b', b: 'c' }, { a: 'a', b: 'c' }])
    const next = removeObject(s, 'b')
    expect(next.objects.map((o) => o.id)).toEqual(['a', 'c'])
    expect(next.links).toEqual([{ a: 'a', b: 'c' }])
  })

  it('moveNote двигает карточку и оставляет её ширину', () => {
    expect(moveNote(base(), 90, 70).note).toEqual({ x: 90, y: 70, w: 400 })
  })
})

describe('toggleLink', () => {
  const s = base([obj('a', 0, 0), obj('b', 300, 0)])

  it('новая пара получает стрелку от первого объекта ко второму', () => {
    expect(toggleLink(s, 'a', 'b').links).toEqual([{ a: 'a', b: 'b' }])
  })

  it('повторное соединение той же пары убирает стрелку, в любую сторону', () => {
    const linked = toggleLink(s, 'a', 'b')
    expect(toggleLink(linked, 'a', 'b').links).toEqual([])
    expect(toggleLink(linked, 'b', 'a').links).toEqual([])
  })

  it('чужие стрелки не трогает', () => {
    const three = base([obj('a', 0, 0), obj('b', 300, 0), obj('c', 600, 0)], [{ a: 'a', b: 'c' }])
    expect(toggleLink(three, 'a', 'b').links).toEqual([{ a: 'a', b: 'c' }, { a: 'a', b: 'b' }])
    expect(toggleLink(toggleLink(three, 'a', 'b'), 'b', 'a').links).toEqual([{ a: 'a', b: 'c' }])
  })
})

describe('linkLine', () => {
  it('идёт от границы одного объекта до границы другого (Клиент → API-шлюз из макета)', () => {
    const line = linkLine({ x: 460, y: 120, w: 110, h: 64 }, { x: 620, y: 120, w: 120, h: 64 })!
    expect(line.x).toBeCloseTo(570)
    expect(line.y).toBeCloseTo(151) // на пиксель выше середины: так линия толщиной 2px ложится по центру
    expect(line.len).toBeCloseTo(50)
    expect(line.ang).toBeCloseTo(0)
  })

  it('направление считается от центров: вниз, вверх и по диагонали', () => {
    const down = linkLine({ x: 0, y: 0, w: 100, h: 60 }, { x: 0, y: 200, w: 100, h: 60 })!
    expect(down.ang).toBeCloseTo(90)
    expect(down.len).toBeCloseTo(140) // 200 между верхними краями минус полвысоты с каждой стороны
    const up = linkLine({ x: 0, y: 200, w: 100, h: 60 }, { x: 0, y: 0, w: 100, h: 60 })!
    expect(up.ang).toBeCloseTo(-90)
    const diag = linkLine({ x: 0, y: 0, w: 40, h: 40 }, { x: 200, y: 200, w: 40, h: 40 })!
    expect(diag.ang).toBeCloseTo(45)
    expect(diag.x).toBeCloseTo(40) // выходит из угла (центр 20,20 + шаг до границы по диагонали)
  })

  it('пересекающиеся и соприкасающиеся объекты стрелки не получают', () => {
    expect(linkLine({ x: 0, y: 0, w: 100, h: 60 }, { x: 50, y: 20, w: 100, h: 60 })).toBeNull()
    expect(linkLine({ x: 0, y: 0, w: 100, h: 60 }, { x: 100, y: 0, w: 100, h: 60 })).toBeNull()
    expect(linkLine({ x: 0, y: 0, w: 100, h: 60 }, { x: 0, y: 0, w: 100, h: 60 })).toBeNull()
  })
})

describe('canvasLines', () => {
  it('пропускает стрелки без объекта и пересекающиеся пары', () => {
    const s = base(
      [obj('a', 0, 0), obj('b', 300, 0), obj('c', 320, 10)],
      [{ a: 'a', b: 'b' }, { a: 'b', b: 'c' }, { a: 'a', b: 'нет' }],
    )
    expect(canvasLines(s)).toHaveLength(1)
  })
})

describe('sameCanvas', () => {
  it('сравнивает по содержимому; порядок стрелок не важен, порядок объектов важен', () => {
    const a = base([obj('a', 0, 0), obj('b', 300, 0)], [{ a: 'a', b: 'b' }])
    const copy = JSON.parse(JSON.stringify(a)) as CanvasState
    expect(sameCanvas(a, copy)).toBe(true)
    expect(sameCanvas(a, patchObject(a, 'a', { x: 1 }))).toBe(false)
    expect(sameCanvas(a, moveNote(a, 25, 28))).toBe(false)
    expect(sameCanvas(a, { ...a, objects: [a.objects[1]!, a.objects[0]!] })).toBe(false)
    expect(sameCanvas(a, { ...a, links: [] })).toBe(false)
    const two = base([obj('a', 0, 0), obj('b', 300, 0), obj('c', 600, 0)], [{ a: 'a', b: 'b' }, { a: 'b', b: 'c' }])
    expect(sameCanvas(two, { ...two, links: [...two.links].reverse() })).toBe(true)
  })
})
