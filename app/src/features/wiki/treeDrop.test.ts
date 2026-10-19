import { describe, expect, it } from 'vitest'
import type { WikiNode } from '../../lib/api/types'
import { moveInList, subtreeIds, treeRows, type TreeRow } from './logic'
import { INDENT, BASE_PAD, levelAt, resolveDrop, sameDrop, type Drop } from './treeDrop'

const node = (id: string, parent: string | null = null): WikiNode => ({
  id,
  parent_id: parent,
  title: id,
  position: 0,
  rev: 1,
  updated_by: null,
  updated_at: '2026-10-18T12:00:00Z',
})

// порядок в массиве — порядок соседей:
//   A            B            C
//   ├ A1         └ B1
//   ├ A2 (раскрыта)
//   │ ├ A21
//   │ └ A22
//   └ A3
const PAGES = [node('A'), node('B'), node('C'), node('A1', 'A'), node('A2', 'A'), node('A3', 'A'), node('A21', 'A2'), node('A22', 'A2'), node('B1', 'B')]

const rowsOf = (pages: WikiNode[], open: string[]): TreeRow[] => treeRows(pages, Object.fromEntries(open.map((id) => [id, true])), '')

const over = (id: string, fy: number, level = 0) => ({ overId: id, fy, level })
const TOP = 0.1
const MID = 0.5
const BOTTOM = 0.9

const gap = (parentId: string | null, beforeId: string | null, depth: number, anchorId: string, side: 'before' | 'after'): Drop => ({
  kind: 'gap',
  parentId,
  beforeId,
  depth,
  anchorId,
  side,
})

describe('зоны строки', () => {
  const rows = rowsOf(PAGES, [])

  it('верхняя четверть — перед страницей', () => {
    expect(resolveDrop(PAGES, rows, 'C', over('A', TOP))).toEqual(gap(null, 'A', 0, 'A', 'before'))
    expect(resolveDrop(PAGES, rows, 'A', over('C', 0))).toEqual(gap(null, 'C', 0, 'C', 'before'))
  })

  it('нижняя четверть — после страницы (перед её следующей соседней)', () => {
    expect(resolveDrop(PAGES, rows, 'C', over('A', BOTTOM))).toEqual(gap(null, 'B', 0, 'A', 'after'))
    expect(resolveDrop(PAGES, rows, 'A', over('B', BOTTOM))).toEqual(gap(null, 'C', 0, 'B', 'after'))
  })

  it('после последней страницы — в конец', () => {
    expect(resolveDrop(PAGES, rows, 'A', over('C', BOTTOM))).toEqual(gap(null, null, 0, 'C', 'after'))
  })

  it('середина — внутрь, в конец вложенных', () => {
    expect(resolveDrop(PAGES, rows, 'C', over('B', MID))).toEqual({ kind: 'into', parentId: 'B' })
    expect(resolveDrop(PAGES, rows, 'C', over('A', 0.25))).toEqual({ kind: 'into', parentId: 'A' })
    expect(resolveDrop(PAGES, rows, 'C', over('A', 0.75))).toEqual({ kind: 'into', parentId: 'A' })
  })

  it('указатель ниже последней строки — в конец списка', () => {
    expect(resolveDrop(PAGES, rows, 'A', { overId: null, fy: 0, level: 0 })).toEqual(gap(null, null, 0, 'C', 'after'))
  })
})

describe('возврат на прежнее место и недопустимые цели', () => {
  const rows = rowsOf(PAGES, [])

  it('на своё место заглушка не показывается', () => {
    // «B» стоит между «A» и «C»: перед «C» и после «A» — то же самое место
    expect(resolveDrop(PAGES, rows, 'B', over('C', TOP))).toBeNull()
    expect(resolveDrop(PAGES, rows, 'B', over('A', BOTTOM))).toBeNull()
    // последняя «C» — в конец
    expect(resolveDrop(PAGES, rows, 'C', over('B', BOTTOM))).toBeNull()
    expect(resolveDrop(PAGES, rows, 'C', { overId: null, fy: 0, level: 0 })).toBeNull()
  })

  it('«внутрь» своего же родителя, когда страница уже последняя в нём, — тоже на месте', () => {
    expect(resolveDrop(PAGES, rowsOf(PAGES, ['A']), 'A3', over('A', MID))).toBeNull()
    expect(resolveDrop(PAGES, rowsOf(PAGES, ['A']), 'A1', over('A', MID))).toEqual({ kind: 'into', parentId: 'A' })
  })

  it('над самой страницей и над её вложенными цели нет', () => {
    const open = rowsOf(PAGES, ['A', 'A2'])
    for (const id of ['A', 'A1', 'A2', 'A21', 'A22', 'A3']) {
      for (const fy of [TOP, MID, BOTTOM]) expect(resolveDrop(PAGES, open, 'A', over(id, fy)), `${id} ${fy}`).toBeNull()
    }
  })

  it('неизвестная страница или строка — цели нет', () => {
    expect(resolveDrop(PAGES, rowsOf(PAGES, []), 'нет', over('A', MID))).toBeNull()
    expect(resolveDrop(PAGES, rowsOf(PAGES, []), 'A', over('нет', MID))).toBeNull()
  })
})

describe('раскрытая страница', () => {
  const open = rowsOf(PAGES, ['A', 'A2'])
  // видимые строки: A, A1, A2, A21, A22, A3, B, C

  it('«после» раскрытой страницы — после всей её ветки, на её уровне', () => {
    expect(resolveDrop(PAGES, open, 'C', over('A', BOTTOM, 0))).toEqual(gap(null, 'B', 0, 'A3', 'after'))
    // у раскрытой вложенной: после всей её ветки, но среди вложенных в «A»
    expect(resolveDrop(PAGES, open, 'C', over('A2', BOTTOM, 1))).toEqual(gap('A', 'A3', 1, 'A22', 'after'))
  })

  it('«внутрь» раскрытой страницы — в конец её вложенных', () => {
    expect(resolveDrop(PAGES, open, 'C', over('A', MID))).toEqual({ kind: 'into', parentId: 'A' })
    expect(resolveDrop(PAGES, open, 'C', over('A2', MID))).toEqual({ kind: 'into', parentId: 'A2' })
  })

  it('первой вложенной — верхняя четверть её первой вложенной', () => {
    expect(resolveDrop(PAGES, open, 'C', over('A1', TOP, 1))).toEqual(gap('A', 'A1', 1, 'A1', 'before'))
    expect(resolveDrop(PAGES, open, 'C', over('A21', TOP, 2))).toEqual(gap('A2', 'A21', 2, 'A21', 'before'))
  })

  it('внизу последней строки ветки уровень выбирает горизонтальное положение', () => {
    // «A3» последняя в «A», «A» не последняя в корне: уровней два
    expect(resolveDrop(PAGES, open, 'C', over('A3', BOTTOM, 1))).toEqual(gap('A', null, 1, 'A3', 'after'))
    expect(resolveDrop(PAGES, open, 'C', over('A3', BOTTOM, 5))).toEqual(gap('A', null, 1, 'A3', 'after'))
    expect(resolveDrop(PAGES, open, 'C', over('A3', BOTTOM, 0))).toEqual(gap(null, 'B', 0, 'A3', 'after'))
    expect(resolveDrop(PAGES, open, 'C', over('A3', BOTTOM, -3))).toEqual(gap(null, 'B', 0, 'A3', 'after'))
  })

  it('«A22» последняя в «A2», но «A2» не последняя в «A»: выбрать можно только эти два уровня', () => {
    expect(resolveDrop(PAGES, open, 'C', over('A22', BOTTOM, 2))).toEqual(gap('A2', null, 2, 'A22', 'after'))
    expect(resolveDrop(PAGES, open, 'C', over('A22', BOTTOM, 1))).toEqual(gap('A', 'A3', 1, 'A22', 'after'))
    // левее нельзя: после «A2» в «A» есть «A3»
    expect(resolveDrop(PAGES, open, 'C', over('A22', BOTTOM, 0))).toEqual(gap('A', 'A3', 1, 'A22', 'after'))
  })

  it('уровни выбираются только среди тех, на которых строка последняя в своей ветке', () => {
    const pages = [node('R'), node('R1', 'R'), node('R11', 'R1'), node('S')]
    const rows = rowsOf(pages, ['R', 'R1'])
    // строки: R, R1, R11, S. «R11» последняя в «R1», «R1» последняя в «R», «R» не последняя в корне («S» после неё)
    expect(resolveDrop(pages, rows, 'S', over('R11', BOTTOM, 2))).toEqual(gap('R1', null, 2, 'R11', 'after'))
    expect(resolveDrop(pages, rows, 'S', over('R11', BOTTOM, 1))).toEqual(gap('R', null, 1, 'R11', 'after'))
    // на уровень корня: после «R» перед следующей за ней страницей; «S» уже стоит именно там
    expect(resolveDrop(pages, rows, 'S', over('R11', BOTTOM, 0))).toBeNull()

    const last = [node('S'), node('R'), node('R1', 'R'), node('R11', 'R1')]
    const rowsLast = rowsOf(last, ['R', 'R1'])
    // «S» первая в корне: после ветки «R» она уходит в конец корня
    expect(resolveDrop(last, rowsLast, 'S', over('R11', BOTTOM, 0))).toEqual(gap(null, null, 0, 'R11', 'after'))
    expect(resolveDrop(last, rowsLast, 'S', over('R11', BOTTOM, 2))).toEqual(gap('R1', null, 2, 'R11', 'after'))
  })

  it('свёрнутая страница с вложенными: «после» — просто после неё', () => {
    const closed = rowsOf(PAGES, [])
    expect(resolveDrop(PAGES, closed, 'C', over('A', BOTTOM))).toEqual(gap(null, 'B', 0, 'A', 'after'))
  })
})

describe('переносимая ветка не считается соседом', () => {
  it('«после» страницы, за которой идёт переносимая, встаёт перед следующей за переносимой', () => {
    const pages = [node('X'), node('D'), node('Y')]
    // «D» между «X» и «Y»: после «X» — на месте; после «Y»: в конец
    expect(resolveDrop(pages, rowsOf(pages, []), 'D', over('X', BOTTOM))).toBeNull()
    expect(resolveDrop(pages, rowsOf(pages, []), 'D', over('Y', BOTTOM))).toEqual(gap(null, null, 0, 'Y', 'after'))
    // «X» после «D»: перед «Y»
    expect(resolveDrop(pages, rowsOf(pages, []), 'X', over('D', BOTTOM))).toEqual(gap(null, 'Y', 0, 'D', 'after'))
  })

  it('последняя вложенная переносится: «после» предпоследней — на месте', () => {
    const rows = rowsOf(PAGES, ['A'])
    expect(resolveDrop(PAGES, rows, 'A3', over('A2', BOTTOM, 1))).toBeNull()
  })

  it('ветка переносимой страницы не мешает искать конец списка', () => {
    const pages = [node('A'), node('A1', 'A'), node('B')]
    const rows = rowsOf(pages, ['A'])
    expect(resolveDrop(pages, rows, 'B', { overId: null, fy: 0, level: 0 })).toBeNull()
    expect(resolveDrop(pages, rows, 'A', { overId: null, fy: 0, level: 0 })).toEqual(gap(null, null, 0, 'B', 'after'))
  })
})

describe('уровень по горизонтали', () => {
  it('считается от левого края строк с шагом вложенности', () => {
    expect(levelAt(100 + BASE_PAD, 100)).toBe(0)
    expect(levelAt(100 + BASE_PAD + INDENT - 1, 100)).toBe(0)
    expect(levelAt(100 + BASE_PAD + INDENT, 100)).toBe(1)
    expect(levelAt(100 + BASE_PAD + 3 * INDENT + 5, 100)).toBe(3)
    expect(levelAt(90, 100)).toBe(-1)
  })
})

describe('sameDrop', () => {
  it('одинаковые цели равны, разные нет', () => {
    expect(sameDrop(null, null)).toBe(true)
    expect(sameDrop(gap(null, 'A', 0, 'A', 'before'), gap(null, 'A', 0, 'A', 'before'))).toBe(true)
    expect(sameDrop(gap(null, 'A', 0, 'A', 'before'), gap(null, 'A', 1, 'A', 'before'))).toBe(false)
    expect(sameDrop(gap(null, 'A', 0, 'A', 'before'), { kind: 'into', parentId: 'A' })).toBe(false)
    expect(sameDrop({ kind: 'into', parentId: 'A' }, { kind: 'into', parentId: 'A' })).toBe(true)
    expect(sameDrop({ kind: 'into', parentId: 'A' }, null)).toBe(false)
  })
})

describe('moveInList', () => {
  const order = (list: WikiNode[], parent: string | null) => list.filter((p) => (p.parent_id ?? null) === parent).map((p) => p.id)

  it('перед указанной страницей', () => {
    expect(order(moveInList(PAGES, 'C', null, 'A'), null)).toEqual(['C', 'A', 'B'])
    expect(order(moveInList(PAGES, 'A', null, 'C'), null)).toEqual(['B', 'A', 'C'])
  })

  it('в конец своих или чужих страниц', () => {
    expect(order(moveInList(PAGES, 'A', null, null), null)).toEqual(['B', 'C', 'A'])
    expect(order(moveInList(PAGES, 'C', 'A', null), 'A')).toEqual(['A1', 'A2', 'A3', 'C'])
  })

  it('к новому родителю и обратно в корень', () => {
    const moved = moveInList(PAGES, 'A3', 'B', 'B1')
    expect(order(moved, 'B')).toEqual(['A3', 'B1'])
    expect(moved.find((p) => p.id === 'A3')!.parent_id).toBe('B')
    expect(order(moveInList(moved, 'A3', null, null), null)).toEqual(['A', 'B', 'C', 'A3'])
  })

  it('страница без вложенных у нового родителя становится первой и единственной', () => {
    const moved = moveInList(PAGES, 'C', 'A1', null)
    expect(order(moved, 'A1')).toEqual(['C'])
    expect(moved).toHaveLength(PAGES.length)
  })

  it('вложенные переезжают вместе с родителем: у них родитель не меняется', () => {
    const moved = moveInList(PAGES, 'A', 'B', null)
    expect(moved.find((p) => p.id === 'A2')!.parent_id).toBe('A')
    expect(order(moved, 'B')).toEqual(['B1', 'A'])
  })

  it('неизвестная страница ничего не меняет', () => {
    expect(moveInList(PAGES, 'нет', null, null)).toBe(PAGES)
  })

  it('результат согласован с тем, что рисует дерево', () => {
    const rows = treeRows(moveInList(PAGES, 'C', 'B', null), { B: true }, '')
    expect(rows.map((r) => `${r.depth}:${r.node.id}`)).toEqual(['0:A', '0:B', '1:B1', '1:C'])
  })
})

describe('subtreeIds', () => {
  it('страница и все вложенные на любую глубину', () => {
    expect([...subtreeIds(PAGES, 'A')].sort()).toEqual(['A', 'A1', 'A2', 'A21', 'A22', 'A3'])
    expect([...subtreeIds(PAGES, 'A2')].sort()).toEqual(['A2', 'A21', 'A22'])
    expect([...subtreeIds(PAGES, 'C')]).toEqual(['C'])
  })
})
