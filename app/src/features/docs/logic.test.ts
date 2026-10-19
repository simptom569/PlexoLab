import { describe, expect, it } from 'vitest'
import type { DocSummary } from '../../lib/api/types'
import { beforeFor, hasThumb, modeLabel, moveDoc, objectsLabel, snippetText, sortLike, thumbBoxes } from './logic'

const ids = (list: Array<{ id: string }>) => list.map((d) => d.id).join('')
const docs = (s: string) => s.split('').map((id) => ({ id }))

describe('подписи карточки', () => {
  it('число объектов склоняется, без объектов — «Без холста»', () => {
    expect(objectsLabel(0)).toBe('Без холста')
    expect(objectsLabel(1)).toBe('1 объект на холсте')
    expect(objectsLabel(3)).toBe('3 объекта на холсте')
    expect(objectsLabel(7)).toBe('7 объектов на холсте')
    expect(objectsLabel(11)).toBe('11 объектов на холсте')
    expect(objectsLabel(21)).toBe('21 объект на холсте')
  })

  it('режим и пустой фрагмент', () => {
    expect(modeLabel('page')).toBe('Страница')
    expect(modeLabel('edge')).toBe('Холст')
    expect(snippetText({ snippet: '' })).toBe('Пустой документ')
    expect(snippetText({ snippet: 'Цели квартала' })).toBe('Цели квартала')
  })

  it('миниатюра только у холста с объектами', () => {
    expect(hasThumb({ mode: 'edge', object_count: 2 })).toBe(true)
    expect(hasThumb({ mode: 'edge', object_count: 0 })).toBe(false)
    expect(hasThumb({ mode: 'page', object_count: 5 })).toBe(false)
  })
})

describe('thumbBoxes', () => {
  const doc: Pick<DocSummary, 'note' | 'thumb'> = {
    note: { x: 24, y: 28, w: 400 },
    thumb: [
      { type: 'rect', x: 460, y: 120, w: 110, h: 64, color: 3 },
      { type: 'text', x: 460, y: 24, w: 220, h: 36, color: 0 },
      { type: 'sticky', x: 10, y: 10, w: 5, h: 5, color: 6 },
    ],
  }

  it('первой идёт карточка с текстом в масштабе 0,2 высотой 30', () => {
    const note = thumbBoxes(doc)[0]!
    expect(note.l).toBeCloseTo(4.8)
    expect(note.t).toBeCloseTo(5.6)
    expect(note).toMatchObject({ w: 80, h: 30, bg: 'var(--surface2)', bd: 'var(--line-strong)' })
  })

  it('объекты уменьшаются в пять раз, цвет по палитре, текст без рамки и фона', () => {
    const [, rect, text] = thumbBoxes(doc)
    expect(rect!.l).toBeCloseTo(92)
    expect(rect!.w).toBeCloseTo(22)
    expect(rect!.h).toBeCloseTo(12.8)
    expect(rect).toMatchObject({ bg: 'var(--a-bg)', bd: 'var(--a-fg)' })
    expect(text).toMatchObject({ bg: 'var(--line-strong)', bd: 'transparent' })
  })

  it('мелкие объекты не меньше 6×4', () => {
    expect(thumbBoxes(doc)[3]).toMatchObject({ w: 6, h: 4 })
  })
})

describe('moveDoc', () => {
  it('ставит документ перед указанным или в конец', () => {
    expect(ids(moveDoc(docs('abcd'), 'd', 'a'))).toBe('dabc')
    expect(ids(moveDoc(docs('abcd'), 'a', null))).toBe('bcda')
    expect(ids(moveDoc(docs('abcd'), 'a', 'c'))).toBe('bacd')
    expect(ids(moveDoc(docs('abcd'), 'c', 'd'))).toBe('abcd')
  })

  it('неизвестный документ и неизвестное «перед» не ломают список', () => {
    const list = docs('abc')
    expect(moveDoc(list, 'z', 'a')).toBe(list)
    expect(ids(moveDoc(list, 'a', 'z'))).toBe('bca')
  })
})

describe('sortLike', () => {
  it('сортирует по порядку полного списка, лишние остаются в конце', () => {
    expect(ids(sortLike(docs('acd'), ['d', 'a', 'b', 'c']))).toBe('dac')
    expect(ids(sortLike(docs('xay'), ['a']))).toBe('axy')
    expect(ids(sortLike(docs('ab'), []))).toBe('ab')
  })
})

describe('beforeFor: куда встаёт документ, если бросили перед видимым', () => {
  const full = ['a', 'b', 'c', 'd', 'e']

  it('без фильтра: перед тем, над кем бросили; на своё место — ничего', () => {
    expect(beforeFor(full, full, 'e', 'a')).toBe('a')
    expect(beforeFor(full, full, 'a', 'd')).toBe('d')
    expect(beforeFor(full, full, 'b', 'b')).toBeUndefined()
    expect(beforeFor(full, full, 'b', 'c')).toBeUndefined() // перед своим соседом справа — то же место
    expect(beforeFor(full, full, 'e', null)).toBeUndefined() // последний в конец — то же место
  })

  it('в конец: null, если в конце видимого стоит последний документ списка', () => {
    expect(beforeFor(full, full, 'a', null)).toBeNull()
    expect(beforeFor(full, full, 'c', null)).toBeNull()
  })

  it('с фильтром бросок в конец видимого не пролетает мимо скрытых документов позади', () => {
    // видны a, c, e; b и d скрыты. «a» бросили в конец видимого: после «e», а «e» в полном списке последний
    expect(beforeFor(full, ['a', 'c', 'e'], 'a', null)).toBeNull()
    // видны a, b, c; d и e скрыты. «a» — в конец видимого: после «c», то есть перед «d»
    expect(beforeFor(full, ['a', 'b', 'c'], 'a', null)).toBe('d')
    // видны a, b; «b» — перед «a»
    expect(beforeFor(full, ['a', 'b'], 'b', 'a')).toBe('a')
  })

  it('с фильтром: перед видимым соседом справа — то же место, даже если между ними скрытые', () => {
    expect(beforeFor(full, ['a', 'c', 'e'], 'a', 'c')).toBeUndefined()
  })

  it('единственный видимый документ некуда переносить', () => {
    expect(beforeFor(full, ['c'], 'c', null)).toBeUndefined()
    expect(beforeFor(full, ['c'], 'c', 'c')).toBeUndefined()
  })
})
