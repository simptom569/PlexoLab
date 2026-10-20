import { describe, expect, it } from 'vitest'
import { diffLines, mapRange, merge3, mergeText, type Hunk } from './merge'

const L = (text: string) => text.split('\n')
const doc = (...paragraphs: string[]) => paragraphs.join('\n\n')

/** Применяет правки к основе: так проверяется, что diff описывает другой текст точно */
function apply(base: string[], hunks: Hunk[]): string[] {
  const out: string[] = []
  let pos = 0
  for (const h of hunks) {
    out.push(...base.slice(pos, h.start), ...h.lines)
    pos = h.end
  }
  out.push(...base.slice(pos))
  return out
}

/** Детерминированный генератор случайных чисел: тест воспроизводим */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('diffLines', () => {
  it('одинаковое: правок нет', () => {
    expect(diffLines(L('a\nb'), L('a\nb'))).toEqual([])
  })

  it('вставка, удаление и замена', () => {
    expect(diffLines(L('a\nc'), L('a\nb\nc'))).toEqual([{ start: 1, end: 1, lines: ['b'] }])
    expect(diffLines(L('a\nb\nc'), L('a\nc'))).toEqual([{ start: 1, end: 2, lines: [] }])
    expect(diffLines(L('a\nb\nc'), L('a\nX\nc'))).toEqual([{ start: 1, end: 2, lines: ['X'] }])
  })

  it('две правки в разных местах дают две правки', () => {
    const hunks = diffLines(L('1\n2\n3\n4\n5'), L('1\nX\n3\n4\nY'))!
    expect(hunks).toEqual([
      { start: 1, end: 2, lines: ['X'] },
      { start: 4, end: 5, lines: ['Y'] },
    ])
  })

  it('слишком большие тексты не сравниваются', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`)
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`)
    expect(diffLines(a, b)).toBeNull()
  })

  it('случайные тексты с повторами: правки точно описывают результат', () => {
    const rand = rng(1)
    const alphabet = ['a', 'b', '', 'c', '']
    const make = () => Array.from({ length: Math.floor(rand() * 12) }, () => alphabet[Math.floor(rand() * alphabet.length)])
    for (let n = 0; n < 500; n++) {
      const base = make()
      const other = make()
      const hunks = diffLines(base, other)!
      expect(apply(base, hunks), `${JSON.stringify(base)} → ${JSON.stringify(other)}`).toEqual(other)
    }
  })
})

describe('слияние: что склеивается', () => {
  it('правки в разных абзацах', () => {
    const base = doc('A', 'B', 'C', 'D')
    expect(mergeText(base, doc('A1', 'B', 'C', 'D'), doc('A', 'B', 'C', 'D1'))!.md).toBe(doc('A1', 'B', 'C', 'D1'))
  })

  it('соседние абзацы: между ними пустая строка, они не пересекаются', () => {
    const base = doc('A', 'B', 'C')
    expect(mergeText(base, doc('A1', 'B', 'C'), doc('A', 'B1', 'C'))!.md).toBe(doc('A1', 'B1', 'C'))
  })

  it('вставка в начало с одной стороны и в конец с другой', () => {
    const base = doc('A', 'B')
    expect(mergeText(base, doc('Начало', 'A', 'B'), doc('A', 'B', 'Конец'))!.md).toBe(doc('Начало', 'A', 'B', 'Конец'))
  })

  it('чужой абзац добавлен выше, а я правлю ниже', () => {
    const base = doc('A', 'B', 'C')
    expect(mergeText(base, doc('A', 'B', 'C1'), doc('Новый', 'A', 'B', 'C'))!.md).toBe(doc('Новый', 'A', 'B', 'C1'))
  })

  it('удаление одного абзаца и правка другого', () => {
    const base = doc('A', 'B', 'C', 'D')
    expect(mergeText(base, doc('A', 'C', 'D1'), doc('A', 'C', 'D'))!.md).toBe(doc('A', 'C', 'D1'))
  })

  it('одинаковая правка с обеих сторон принимается один раз', () => {
    const base = doc('A', 'B')
    expect(mergeText(base, doc('A1', 'B', 'Z'), doc('A', 'B', 'Z'))!.md).toBe(doc('A1', 'B', 'Z'))
  })

  it('моя версия не менялась: берётся чужая', () => {
    const base = doc('A', 'B')
    expect(mergeText(base, base, doc('A', 'B', 'C'))!.md).toBe(doc('A', 'B', 'C'))
  })

  it('чужая версия не менялась или совпала с моей: остаётся моя', () => {
    const base = doc('A', 'B')
    expect(mergeText(base, doc('A1', 'B'), base)!.md).toBe(doc('A1', 'B'))
    expect(mergeText(base, doc('A1', 'B'), doc('A1', 'B'))!.md).toBe(doc('A1', 'B'))
  })
})

describe('слияние: вставка блока между абзацами не мешает правке соседа', () => {
  // у такой вставки два равноценных описания: «после P4» и «перед P5». Без сдвига правка одного из соседей давала бы ложный конфликт.
  const base = doc('P4', 'P5', 'P6')

  it('сосед снизу правит свой абзац', () => {
    expect(mergeText(base, doc('P4', 'X', 'P5', 'P6'), doc('P4', 'P5t', 'P6'))!.md).toBe(doc('P4', 'X', 'P5t', 'P6'))
  })

  it('сосед сверху правит свой абзац', () => {
    expect(mergeText(base, doc('P4', 'X', 'P5', 'P6'), doc('P4t', 'P5', 'P6'))!.md).toBe(doc('P4t', 'X', 'P5', 'P6'))
  })

  it('чужая вставка между абзацами и моя правка соседа', () => {
    expect(mergeText(base, doc('P4t', 'P5', 'P6'), doc('P4', 'X', 'P5', 'P6'))!.md).toBe(doc('P4t', 'X', 'P5', 'P6'))
    expect(mergeText(base, doc('P4', 'P5t', 'P6'), doc('P4', 'X', 'P5', 'P6'))!.md).toBe(doc('P4', 'X', 'P5t', 'P6'))
  })

  it('удаление абзаца и правка соседа с любой стороны', () => {
    expect(mergeText(base, doc('P4', 'P6'), doc('P4t', 'P5', 'P6'))!.md).toBe(doc('P4t', 'P6'))
    expect(mergeText(base, doc('P4', 'P6'), doc('P4', 'P5', 'P6t'))!.md).toBe(doc('P4', 'P6t'))
  })
})

describe('слияние: что остаётся выбором человека', () => {
  it('одна и та же строка правлена по-разному', () => {
    expect(mergeText(doc('A', 'B'), doc('A1', 'B'), doc('A2', 'B'))).toBeNull()
  })

  it('оба печатают на новой строке в одном месте: как в git, конфликт', () => {
    const base = doc('A', 'B')
    expect(mergeText(base, doc('A', 'B', 'Мой'), doc('A', 'B', 'Его'))).toBeNull()
    expect(mergeText(base, doc('A', 'Мой', 'B'), doc('A', 'Его', 'B'))).toBeNull()
  })

  it('соседние строки списка: как в git, конфликт', () => {
    expect(mergeText('1\n2\n3\n4', '1\n2m\n3\n4', '1\n2\n3t\n4')).toBeNull()
  })

  it('удалил абзац, а другой его правил', () => {
    const base = doc('A', 'B', 'C')
    expect(mergeText(base, doc('A', 'C'), doc('A', 'B1', 'C'))).toBeNull()
  })

  it('вставка между абзацами, когда правлены оба соседа: сдвигать некуда', () => {
    const base = doc('P4', 'P5', 'P6')
    expect(mergeText(base, doc('P4', 'X', 'P5', 'P6'), doc('P4t', 'P5t', 'P6'))).toBeNull()
  })

  it('правка, убравшая закрывающие ```, рядом с чужой правкой не склеивается', () => {
    const base = 'intro\n\n```\ncode\n```\n\nend'
    expect(mergeText(base, 'intro\n\n```\ncode\n\nend', 'intro\n\n```\ncode\n```\n\nend2')).toBeNull()
  })

  it('а целый новый блок кода склеивается: ограждений в нём чётное число', () => {
    const base = doc('intro', 'end')
    const mine = doc('intro', '```\ncode\n```', 'end')
    expect(mergeText(base, mine, doc('intro', 'end2'))!.md).toBe(doc('intro', '```\ncode\n```', 'end2'))
  })

  it('слишком большой текст не склеивается', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`).join('\n')
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`).join('\n')
    expect(mergeText('x', a, b)).toBeNull()
  })
})

describe('карта строк', () => {
  it('мой блок сдвинулся вниз, потому что выше добавили абзац', () => {
    const base = doc('A', 'B', 'C')
    const m = merge3(L(base), L(doc('A', 'B', 'C1')), L(doc('Новый', 'A', 'B', 'C')))!
    expect(m.lines).toEqual(L(doc('Новый', 'A', 'B', 'C1')))
    // моя строка «C1» была шестой строкой (индекс 4), стала восьмой (индекс 6)
    expect(m.map[4]).toBe(6)
    expect(mapRange(m.map, 4, 5)).toEqual({ start: 6, end: 7 })
  })

  it('у каждой строки моей версии есть место в результате или -1', () => {
    const m = merge3(L(doc('A', 'B', 'C')), L(doc('A1', 'B', 'C')), L(doc('A', 'B')))!
    expect(m.lines).toEqual(L(doc('A1', 'B')))
    expect(m.map).toEqual([0, 1, 2, -1, -1]) // «C» и пустая перед ней убраны чужой правкой
    expect(mapRange(m.map, 3, 5)).toBeNull()
  })

  it('блок, в который чужие строки попали внутрь, растёт на них', () => {
    const base = '- a\n- b\n- c'
    const m = merge3(L(base), L(base + '\n- d'), L('- a\n- NEW\n- b\n- c'))!
    expect(m.lines).toEqual(['- a', '- NEW', '- b', '- c', '- d'])
    expect(mapRange(m.map, 0, 4)).toEqual({ start: 0, end: 5 })
  })

  it('моя версия не менялась: все строки на месте или убраны', () => {
    const base = doc('A', 'B')
    const m = merge3(L(base), L(base), L(doc('A', 'B', 'C')))!
    expect(m.map).toEqual([0, 1, 2])
  })
})

// ----- случайные проверки -----

type Doc = string[] // абзацы

const text = (paragraphs: Doc) => paragraphs.join('\n\n')

describe('случайные правки', () => {
  const base = (n: number): Doc => Array.from({ length: n }, (_, i) => `p${i}`)

  it('независимые правки двух людей (расстояние от двух абзацев) всегда склеиваются и ничего не теряют', () => {
    const rand = rng(7)
    for (let round = 0; round < 500; round++) {
      const n = 8 + Math.floor(rand() * 10)
      const start = base(n)
      // положения правок: у каждой стороны свои, между сторонами не меньше двух абзацев
      const mineAt: number[] = []
      const theirAt: number[] = []
      for (let i = 0; i < n; i++) {
        const pick = rand()
        const near = [...mineAt, ...theirAt].some((p) => Math.abs(p - i) < 3 && !(mineAt.includes(p) === mineAt.includes(i)))
        if (pick < 0.15 && !near && !theirAt.some((p) => Math.abs(p - i) < 3)) mineAt.push(i)
        else if (pick < 0.3 && !mineAt.some((p) => Math.abs(p - i) < 3)) theirAt.push(i)
      }
      const edit = (at: number[], who: string): { doc: Doc; tokens: string[] } => {
        const out = [...start]
        const tokens: string[] = []
        // с конца, чтобы номера не сдвигались
        for (const i of [...at].sort((a, b) => b - a)) {
          const kind = Math.floor(rand() * 3)
          const token = `${who}${i}`
          if (kind === 0) out[i] = token
          else if (kind === 1) out.splice(i + 1, 0, token)
          else out.splice(i, 1)
          if (kind !== 2) tokens.push(token)
        }
        return { doc: out, tokens }
      }
      const mine = edit(mineAt, 'm')
      const theirs = edit(theirAt, 't')
      const merged = mergeText(text(start), text(mine.doc), text(theirs.doc))
      expect(merged, `слияние не вышло: ${JSON.stringify({ mineAt, theirAt, mine: mine.doc, theirs: theirs.doc })}`).not.toBeNull()
      const result = merged!.md.split('\n\n')
      for (const token of [...mine.tokens, ...theirs.tokens]) expect(result.filter((p) => p === token), token).toHaveLength(1)
      // нетронутые абзацы остались, лишнего нет
      const expectedCount = result.filter((p) => /^p\d+$/.test(p)).length
      const survivors = start.filter((_, i) => {
        const removed = (doc: Doc) => !doc.includes(`p${i}`) && !doc.includes(`m${i}`) && !doc.includes(`t${i}`)
        return !(removed(mine.doc) && !mine.doc.includes(`m${i}`)) && !(removed(theirs.doc) && !theirs.doc.includes(`t${i}`))
      })
      expect(expectedCount).toBeLessThanOrEqual(survivors.length)
    }
  })

  it('любые правки: если слияние вышло, текст каждой стороны на месте ровно один раз', () => {
    const rand = rng(11)
    let merged = 0
    for (let round = 0; round < 800; round++) {
      const n = 4 + Math.floor(rand() * 6)
      const start = base(n)
      const edit = (who: string) => {
        const out = [...start]
        const tokens: string[] = []
        const count = 1 + Math.floor(rand() * 3)
        for (let k = 0; k < count; k++) {
          const i = Math.floor(rand() * out.length)
          const token = `${who}${k}`
          const kind = Math.floor(rand() * 3)
          if (kind === 0 && /^p\d+$/.test(out[i] ?? '')) {
            out[i] = token
            tokens.push(token)
          } else if (kind === 1) {
            out.splice(i + 1, 0, token)
            tokens.push(token)
          } else if (/^p\d+$/.test(out[i] ?? '')) out.splice(i, 1)
        }
        return { doc: out, tokens }
      }
      const mine = edit('m')
      const theirs = edit('t')
      const result = mergeText(text(start), text(mine.doc), text(theirs.doc))
      if (!result) continue
      merged++
      const paragraphs = result.md.split('\n\n')
      // токен мог пропасть только вместе с абзацем, который другая сторона удалила (тогда правки пересекались бы)
      for (const token of [...mine.tokens, ...theirs.tokens]) {
        expect(paragraphs.filter((p) => p === token), `${token} в ${JSON.stringify({ mine: mine.doc, theirs: theirs.doc, result: paragraphs })}`).toHaveLength(1)
      }
    }
    expect(merged, 'слияние должно получаться часто, иначе от него нет толку').toBeGreaterThan(150)
  })
})
