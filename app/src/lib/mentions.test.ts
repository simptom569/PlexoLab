import { describe, expect, it } from 'vitest'
import { activeMention, countMarks, filterMentionable, insertMention, MAX_QUERY, splitMarks, toWire, type Mentionable } from './mentions'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

const lena: Mentionable = { id: A, name: 'Лена М.' }
const artem: Mentionable = { id: B, name: 'Артём К.' }

describe('splitMarks', () => {
  it('режет текст на куски и метки', () => {
    expect(splitMarks(`@[${A}] посмотри, @[${B}] тоже`)).toEqual([
      { kind: 'mark', id: A },
      { kind: 'text', text: ' посмотри, ' },
      { kind: 'mark', id: B },
      { kind: 'text', text: ' тоже' },
    ])
  })

  it('текст без меток один кусок, пустой текст пуст', () => {
    expect(splitMarks('просто текст')).toEqual([{ kind: 'text', text: 'просто текст' }])
    expect(splitMarks('')).toEqual([])
  })

  it('похожее на метку остаётся текстом', () => {
    for (const body of ['@[не-id]', '@[]', '[скобки]', '@Лена', `@[${A.slice(0, 35)}]`, `@${A}`]) {
      expect(splitMarks(body)).toEqual([{ kind: 'text', text: body }])
    }
  })

  it('id в верхнем регистре приводится к нижнему, как на сервере', () => {
    expect(splitMarks(`@[${A.toUpperCase()}]`)).toEqual([{ kind: 'mark', id: A }])
  })

  it('метка вплотную к тексту и знакам', () => {
    expect(splitMarks(`(@[${A}])!`)).toEqual([
      { kind: 'text', text: '(' },
      { kind: 'mark', id: A },
      { kind: 'text', text: ')!' },
    ])
    expect(splitMarks(`@[${A}]@[${B}]`).map((p) => p.kind)).toEqual(['mark', 'mark'])
  })
})

describe('activeMention', () => {
  it('«@» в начале и после пробела или перевода строки', () => {
    expect(activeMention('@', 1)).toEqual({ at: 0, query: '' })
    expect(activeMention('привет @ле', 10)).toEqual({ at: 7, query: 'ле' })
    expect(activeMention('строка\n@а', 9)).toEqual({ at: 7, query: 'а' })
  })

  it('в адресе почты это не упоминание', () => {
    expect(activeMention('почта a@b', 9)).toBeNull()
    expect(activeMention('x@', 2)).toBeNull()
  })

  it('без «@» перед курсором упоминания нет', () => {
    expect(activeMention('привет', 6)).toBeNull()
    expect(activeMention('@лена потом текст', 0)).toBeNull() // курсор в самом начале
  })

  it('берётся ближайшая «@» слева от курсора', () => {
    expect(activeMention('@лена и @ар', 11)).toEqual({ at: 8, query: 'ар' })
  })

  it('пробел в запросе допустим (имя «Лена М.»), перевод строки нет', () => {
    expect(activeMention('@Лена М', 7)).toEqual({ at: 0, query: 'Лена М' })
    expect(activeMention('@Лена\nМ', 7)).toBeNull()
  })

  it('слишком длинный запрос уже не имя', () => {
    const q = 'я'.repeat(MAX_QUERY)
    expect(activeMention(`@${q}`, MAX_QUERY + 1)).toEqual({ at: 0, query: q })
    expect(activeMention(`@${q}я`, MAX_QUERY + 2)).toBeNull()
  })

  it('курсор в середине текста: смотрим только то, что до него', () => {
    expect(activeMention('@ле конец', 3)).toEqual({ at: 0, query: 'ле' })
  })
})

describe('filterMentionable', () => {
  const people: Mentionable[] = [lena, artem, { id: 'c', name: 'Даниил' }, { id: 'd', name: 'Соня' }, { id: 'e', name: 'Игорь Леонтьев' }]

  it('пустой запрос: первые по списку', () => {
    expect(filterMentionable(people, '').map((p) => p.name)).toEqual(['Лена М.', 'Артём К.', 'Даниил', 'Соня', 'Игорь Леонтьев'])
    expect(filterMentionable(people, '', 2)).toHaveLength(2)
  })

  it('по началу имени без учёта регистра', () => {
    expect(filterMentionable(people, 'ле').map((p) => p.name)).toEqual(['Лена М.', 'Игорь Леонтьев'])
    expect(filterMentionable(people, 'ЛЕ').map((p) => p.name)).toEqual(['Лена М.', 'Игорь Леонтьев'])
  })

  it('сначала имена с этого начала, потом те, где с него начинается слово', () => {
    expect(filterMentionable(people, 'к').map((p) => p.name)).toEqual(['Артём К.'])
    expect(filterMentionable(people, 'м').map((p) => p.name)).toEqual(['Лена М.'])
    expect(filterMentionable([{ id: 'x', name: 'Анна Лебедева' }, lena], 'ле').map((p) => p.name)).toEqual(['Лена М.', 'Анна Лебедева'])
  })

  it('запрос с пробелом ищет только по началу всего имени', () => {
    expect(filterMentionable(people, 'лена м').map((p) => p.name)).toEqual(['Лена М.'])
    expect(filterMentionable(people, 'м. к')).toEqual([])
  })

  it('никого не нашли: пусто', () => {
    expect(filterMentionable(people, 'яя')).toEqual([])
  })
})

describe('insertMention', () => {
  it('имя встаёт вместо набранного, после него пробел и курсор', () => {
    const text = 'привет @ле, как дела'
    const m = activeMention(text, 10)!
    expect(insertMention(text, m, 10, 'Лена М.')).toEqual({ text: 'привет @Лена М. , как дела', caret: 16 })
  })

  it('в конце текста', () => {
    const m = activeMention('@а', 2)!
    expect(insertMention('@а', m, 2, 'Артём К.')).toEqual({ text: '@Артём К. ', caret: 10 })
  })

  it('сразу после вставки список не открывается снова', () => {
    const { text, caret } = insertMention('@л', activeMention('@л', 2)!, 2, 'Лена М.')
    const again = activeMention(text, caret)
    expect(filterMentionable([lena], again?.query ?? '')).toEqual([])
  })
})

describe('toWire', () => {
  it('имя выбранного человека становится меткой', () => {
    expect(toWire('@Лена М. посмотри', [lena])).toBe(`@[${A}] посмотри`)
  })

  it('несколько людей и повторы', () => {
    expect(toWire('@Лена М. и @Артём К., ещё раз @Лена М.', [lena, artem, lena])).toBe(`@[${A}] и @[${B}], ещё раз @[${A}]`)
  })

  it('не выбранное из списка остаётся текстом', () => {
    expect(toWire('@Лена М. и @Артём К.', [lena])).toBe(`@[${A}] и @Артём К.`)
    expect(toWire('привет @Соня', [lena])).toBe('привет @Соня')
  })

  it('имя, которое поправили руками, меткой не становится', () => {
    expect(toWire('@Лена Мельникова', [lena])).toBe('@Лена Мельникова')
    expect(toWire('@Лена', [lena])).toBe('@Лена')
  })

  it('имя не склеивается с продолжением слова', () => {
    expect(toWire('@Лена М.ушла', [lena])).toBe('@Лена М.ушла')
    expect(toWire('@Лена М., привет', [lena])).toBe(`@[${A}], привет`)
  })

  it('«@» внутри слова не считается упоминанием', () => {
    expect(toWire('почта x@Лена М.', [lena])).toBe('почта x@Лена М.')
  })

  it('более длинное имя не съедается коротким', () => {
    const long: Mentionable = { id: B, name: 'Лена М. Петрова' }
    expect(toWire('@Лена М. Петрова и @Лена М.', [lena, long])).toBe(`@[${B}] и @[${A}]`)
  })

  it('одинаковые имена получают метки в порядке выбора', () => {
    const second: Mentionable = { id: B, name: 'Лена М.' }
    expect(toWire('@Лена М. и @Лена М.', [lena, second])).toBe(`@[${A}] и @[${B}]`)
  })

  it('знаки регулярных выражений в имени не ломают разбор', () => {
    const odd: Mentionable = { id: A, name: 'К.(Ю)+' }
    expect(toWire('@К.(Ю)+ тут', [odd])).toBe(`@[${A}] тут`)
  })

  it('без выбранных текст не меняется', () => {
    expect(toWire('@Лена М.', [])).toBe('@Лена М.')
  })
})

describe('countMarks', () => {
  it('считает разных людей', () => {
    expect(countMarks(`@[${A}] @[${B}] @[${A}]`)).toBe(2)
    expect(countMarks('без упоминаний')).toBe(0)
  })
})
