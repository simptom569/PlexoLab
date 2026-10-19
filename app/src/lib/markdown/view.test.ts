import { describe, expect, it } from 'vitest'
import { mdBlocks } from './engine'
import { describeBlock, type BlockView } from './view'

/** Вид первого блока текста */
const view = (md: string, titles: string[] = []): BlockView => {
  const lines = md.split('\n')
  return describeBlock(lines, mdBlocks(lines, 0)[0], titles)
}

const text = (v: BlockView) => {
  if (v.kind !== 'text') throw new Error(`ожидался текст, а не ${v.kind}`)
  return v
}

describe('describeBlock: текстовые блоки', () => {
  it('заголовок без решёток', () => {
    const v = text(view('## Имена веток'))
    expect(v.cls).toBe('h2')
    expect(v.lines).toEqual([[{ t: 'Имена веток', cls: '' }]])
  })

  it('абзац — строка на каждую строку текста', () => {
    const v = text(view('Раз\nдва'))
    expect(v.cls).toBe('p')
    expect(v.lines.map((l) => l[0].t)).toEqual(['Раз', 'два'])
  })

  it('цитата без маркеров', () => {
    const v = text(view('> первая\n> вторая\n>без пробела'))
    expect(v.cls).toBe('quote')
    expect(v.title).toBeUndefined()
    expect(v.lines.map((l) => l[0].t)).toEqual(['первая', 'вторая', 'без пробела'])
  })

  it('выноска берёт название из тега, если своего нет', () => {
    const v = text(view('> [!tip] Как редактировать\n> Нажми на абзац.'))
    expect(v.cls).toBe('callout')
    expect(v.title).toBe('Как редактировать')
    expect(v.lines.map((l) => l[0].t)).toEqual(['Нажми на абзац.'])
    expect(text(view('> [!warning]\n> текст')).title).toBe('Важно')
    expect(text(view('> [!TIP]\n> текст')).title).toBe('Совет')
    expect(text(view('> [!custom]\n> текст')).title).toBe('custom')
  })

  it('разметка внутри строки разобрана', () => {
    const v = text(view('а **б**'))
    expect(v.lines[0].map((r) => r.cls)).toEqual(['', 'b'])
  })
})

describe('describeBlock: ссылки на страницы вики', () => {
  it('существующая страница без пометки, отсутствующая с пометкой miss', () => {
    const v = text(view('[[Деплой и окружения]] и [[Нет такой]]', ['деплой и окружения']))
    expect(v.lines[0]).toEqual([
      { t: 'Деплой и окружения', cls: 'wl', wiki: 'Деплой и окружения' },
      { t: ' и ', cls: '' },
      { t: 'Нет такой', cls: 'wl miss', wiki: 'Нет такой' },
    ])
  })

  it('регистр названия не важен', () => {
    const v = text(view('[[ДЕПЛОЙ]]', ['деплой']))
    expect(v.lines[0][0].cls).toBe('wl')
  })
})

describe('describeBlock: списки', () => {
  it('маркированный список с задачами', () => {
    const v = view('- [x] Прочитать\n- [ ] Поднять\n- обычный')
    if (v.kind !== 'list') throw new Error(v.kind)
    expect(v.items.map((i) => [i.isCheck, i.done, i.dot, i.line])).toEqual([
      [true, true, '•', 0],
      [true, false, '•', 1],
      [false, false, '•', 2],
    ])
    expect(v.items[0].runs).toEqual([{ t: 'Прочитать', cls: '' }])
  })

  it('нумерация идёт по уровням и сбрасывается при выходе из вложенности', () => {
    const v = view('1. один\n  1. вложенный\n  2. ещё\n2. два\n- маркер\n3) три')
    if (v.kind !== 'list') throw new Error(v.kind)
    expect(v.items.map((i) => [i.pad, i.dot])).toEqual([
      [0, '1.'],
      [22, '1.'],
      [22, '2.'],
      [0, '2.'],
      [0, '•'],
      [0, '1.'],
    ])
  })

  it('табуляция считается двумя пробелами', () => {
    const v = view('- а\n\t- б\n\t\t- в')
    if (v.kind !== 'list') throw new Error(v.kind)
    expect(v.items.map((i) => i.pad)).toEqual([0, 22, 44])
  })

  it('номер строки учитывает начало блока', () => {
    const lines = 'Текст\n\n- [ ] А\n- [ ] Б'.split('\n')
    const v = describeBlock(lines, mdBlocks(lines, 0)[1], [])
    if (v.kind !== 'list') throw new Error(v.kind)
    expect(v.items.map((i) => i.line)).toEqual([2, 3])
  })
})

describe('describeBlock: код, разделитель, таблица', () => {
  it('код с языком', () => {
    expect(view('```bash\nmake release\n```')).toEqual({ kind: 'code', code: 'make release', lang: 'bash' })
  })

  it('пустой код показывается пробелом, незакрытый — до конца', () => {
    expect(view('```\n```')).toEqual({ kind: 'code', code: ' ', lang: '' })
    expect(view('```\nа\nб')).toEqual({ kind: 'code', code: 'а\nб', lang: '' })
  })

  it('разделитель', () => {
    expect(view('---')).toEqual({ kind: 'hr' })
  })

  it('таблица: первая строка — шапка, строка из дефисов пропущена', () => {
    const v = view('| Тип | Пример |\n| --- | :---: |\n| feat | вход |\n| fix |')
    if (v.kind !== 'table') throw new Error(v.kind)
    expect(v.cols).toBe(2)
    expect(v.cells.map((c) => [c.head, c.runs[0].t.trim()])).toEqual([
      [true, 'Тип'],
      [true, 'Пример'],
      [false, 'feat'],
      [false, 'вход'],
      [false, 'fix'],
      [false, ''],
    ])
  })

  it('число колонок — по самой длинной строке', () => {
    const v = view('| а |\n| 1 | 2 | 3 |')
    if (v.kind !== 'table') throw new Error(v.kind)
    expect(v.cols).toBe(3)
    expect(v.cells).toHaveLength(6)
  })
})
