// Сверка с макетом: те же входные данные пропускаем через код из design/ и через порт на TypeScript, результаты должны
// совпасть. Так «без изменения поведения» проверяется, а не обещается. design/ только читается.

import { describe, expect, it } from 'vitest'
import mockupHtml from '../../../../design/Main.dc.html?raw'
import engineSource from '../../../../design/reference/markdown-engine.js?raw'
import { LIST_RE, mdBlocks, mdInline, mdKindOf, mdTidy, rowsFor } from './engine'
import { append, insertBlock, keyAction, split, toggleCheck, type Edit } from './ops'

// ----- разбор: reference/markdown-engine.js -----

type RefEngine = {
  mdBlocks: typeof mdBlocks
  mdKindOf: typeof mdKindOf
  mdTidy: typeof mdTidy
  mdInline: typeof mdInline
  rowsFor: typeof rowsFor
}
const ref = new Function(`${engineSource}; return { mdBlocks, mdKindOf, mdTidy, mdInline, rowsFor }`)() as RefEngine

// ----- правки: методы md* класса Component из Main.dc.html -----

const html = mockupHtml
const from = html.indexOf('  mdGet(key) {')
const to = html.indexOf('  // Отрисованный вид одного блока')
if (from < 0 || to < from) throw new Error('в макете не нашлись методы md*')

type Fake = {
  S: () => State
  setState: (patch: Partial<State>) => void
  focusSoon: () => void
  _caret: unknown
  mdKey: (key: string, e: unknown) => void
  mdInsert: (key: string, text: string, caret?: number) => void
  mdAppend: (key: string) => void
  mdToggle: (key: string, line: number) => void
  mdSplit: (key: string, ed: object, before: string, after: string) => void
}
type State = { wiki: { id: string; md: string }[]; docs: unknown[]; edit: { key: string; start: number; end: number; t: number } | null }

const Host = new Function(
  'mdBlocks',
  'mdKindOf',
  'mdTidy',
  'LIST_RE',
  `return class Host {\n${html.slice(from, to)}\n}`,
)(ref.mdBlocks, ref.mdKindOf, ref.mdTidy, LIST_RE) as new () => Fake

const UNSET = Symbol('не задан')

/** Макет с одной страницей `md` и активным блоком `ed` (или без него) */
function mockup(md: string, ed: Edit | null) {
  const state: State = { wiki: [{ id: 'x', md }], docs: [], edit: ed && { key: 'w:x', ...ed, t: 1 } }
  const h = new Host()
  h.S = () => state
  h.setState = (patch) => Object.assign(state, patch)
  h.focusSoon = () => {}
  h._caret = UNSET
  return {
    h,
    outcome: () => ({
      md: state.wiki[0].md,
      edit: state.edit && { start: state.edit.start, end: state.edit.end },
      caret: h._caret === UNSET ? undefined : h._caret,
    }),
  }
}

// ----- входные данные -----

const DOCS = [
  '',
  'Один абзац',
  'Раз\nдва\n\nТри',
  '# Заголовок\n\nТекст\n\n## Второй\n\n### Третий',
  '- один\n- два\n  - вложенный\n- три',
  '1. один\n2. два\n  1. вложенный\n3. три',
  '- [ ] задача\n- [x] готово\n- [X] тоже',
  '> цитата\n> вторая строка\n\n> [!tip] Совет\n> текст выноски',
  '```bash\nmake release\n```\n\nпосле кода',
  '```\nбез конца\nещё строка',
  '| Тип | Пример |\n| --- | --- |\n| feat | вход |\n|  |  |',
  '---\n\nПосле разделителя\n\n***',
  'А\n\n\n\nБ\n\n',
  '\n\nПусто в начале',
  'Привет **мир** и *курсив* с `кодом`, [[Страница|подпись]] и [ссылка](https://example.com) #тег',
  '-\n\n#\n\n>\n\n1.\n\n- [ ]',
  'Каждая задача проходит колонки доски слева направо.\n\n1. Новая идея сначала попадает в бэклог\n2. Берёшь задачу в работу\n3. Когда готов PR, переносишь карточку\n4. Влили в main, значит «Готово»',
]

const KEYS: { key: string; shiftKey?: boolean; ctrlKey?: boolean }[] = [
  { key: 'Enter' },
  { key: 'Enter', shiftKey: true },
  { key: 'Enter', ctrlKey: true },
  { key: 'Backspace' },
  { key: 'ArrowUp' },
  { key: 'ArrowDown' },
  { key: 'Tab' },
  { key: 'Tab', shiftKey: true },
  { key: 'b', ctrlKey: true },
  { key: 'I', ctrlKey: true },
  { key: 'Escape' },
  { key: 'a' },
  { key: 'ArrowLeft' },
]

/** Все блоки текста и все его пустые строки как возможные активные диапазоны */
function ranges(md: string): Edit[] {
  const lines = md.split('\n')
  const out: Edit[] = mdBlocks(lines, 0).map((b) => ({ start: b.start, end: b.end }))
  lines.forEach((l, i) => {
    if (!l.trim()) out.push({ start: i, end: i + 1 })
  })
  return out
}

/** Положения курсора и выделения в тексте блока: начало, середина, конец и выделение внутри */
function cursors(value: string): [number, number][] {
  const mid = Math.floor(value.length / 2)
  const out: [number, number][] = [[0, 0], [mid, mid], [value.length, value.length]]
  if (value.length > 2) out.push([1, value.length - 1])
  const nl = value.indexOf('\n')
  if (nl >= 0) out.push([nl, nl], [nl + 1, nl + 1])
  return out
}

// ----- генератор случайных текстов -----

function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PIECES = [
  '# ', '## ', '### ', '#### ', '- ', '* ', '+ ', '1. ', '2) ', '> ', '> [!tip] ', '[!note] ', '```', '```bash', '|', ' | ', '---', '***',
  '[ ] ', '[x] ', '  ', '\t', '**', '*', '~~', '`', '[[', ']]', '[', '](', ')', 'http://a.b', '#тег', '#', 'слово', 'Слово', 'a', ' ', ' ', '\n',
  '\n', '\n\n', '\n\n\n', '-', '.', '|', '_',
]

function randomText(next: () => number) {
  let s = ''
  const n = 1 + Math.floor(next() * 14)
  for (let i = 0; i < n; i++) s += PIECES[Math.floor(next() * PIECES.length)]
  return s
}

// ----- проверки -----

describe('разбор совпадает с reference/markdown-engine.js', () => {
  const samples = [...DOCS]
  const next = prng(20261018)
  for (let i = 0; i < 4000; i++) samples.push(randomText(next))

  it('mdBlocks и mdKindOf', () => {
    for (const md of samples) {
      const lines = md.split('\n')
      expect(mdBlocks(lines, 0), JSON.stringify(md)).toEqual(ref.mdBlocks(lines, 0))
      expect(mdBlocks(lines, 7), JSON.stringify(md)).toEqual(ref.mdBlocks(lines, 7))
      expect(mdKindOf(md), JSON.stringify(md)).toBe(ref.mdKindOf(md))
    }
  })

  it('mdTidy', () => {
    for (const md of samples) expect(mdTidy(md), JSON.stringify(md)).toBe(ref.mdTidy(md))
  })

  it('mdInline и rowsFor', () => {
    for (const md of samples) {
      for (const line of md.split('\n')) expect(mdInline(line), JSON.stringify(line)).toEqual(ref.mdInline(line))
      expect(rowsFor(md)).toBe(ref.rowsFor(md))
    }
  })
})

describe('правки совпадают с методами md* макета', () => {
  it('клавиши в активном блоке', () => {
    let checked = 0
    for (const md of DOCS) {
      for (const ed of ranges(md)) {
        const value = md.split('\n').slice(ed.start, ed.end).join('\n')
        for (const [selStart, selEnd] of cursors(value)) {
          for (const k of KEYS) {
            const label = `${JSON.stringify(md)} блок ${ed.start}-${ed.end} курсор ${selStart}-${selEnd} ${k.ctrlKey ? 'Ctrl+' : ''}${k.shiftKey ? 'Shift+' : ''}${k.key}`
            const m = mockup(md, ed)
            let prevented = false
            const target = { value, selectionStart: selStart, selectionEnd: selEnd, tagName: 'TEXTAREA' }
            // mdWrap читает выделение прямо из документа
            ;(globalThis as { document?: unknown }).document = { querySelector: () => target }
            m.h.mdKey('w:x', { ...k, target, preventDefault: () => (prevented = true) })
            delete (globalThis as { document?: unknown }).document

            const mine = keyAction(md, ed, {
              key: k.key,
              shift: !!k.shiftKey,
              mod: !!k.ctrlKey,
              value,
              selStart,
              selEnd,
            })
            const expected = m.outcome()
            if (!mine) {
              expect(prevented, label).toBe(false)
              expect(expected, label).toEqual({ md, edit: ed, caret: undefined })
            } else if (k.key === 'Escape' || (k.ctrlKey && k.key === 'Enter')) {
              // Единственное намеренное отличие от макета: выход из блока чистит текст только вокруг блока (`mdTidyBlock`),
              // а не весь документ, иначе у другого человека пропал бы его пустой блок. Проверяем, что мы не сделали ничего
              // лишнего: добавив к нашему результату остаток очистки макета, получаем в точности результат макета.
              expect(prevented, label).toBe(true)
              expect({ md: mdTidy(mine.step.md), edit: mine.step.edit, caret: mine.step.caret }, label).toEqual(expected)
            } else {
              expect(prevented, label).toBe(true)
              expect({ md: mine.step.md, edit: mine.step.edit, caret: mine.step.caret }, label).toEqual(expected)
            }
            checked++
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(2000)
  })

  const TOOLS: [string, number?][] = [
    ['# '], ['## '], ['- '], ['1. '], ['- [ ] '], ['> '], ['> [!note] Заметка\n> '], ['```\n\n```', 4],
    ['| Колонка 1 | Колонка 2 | Колонка 3 |\n| --- | --- | --- |\n|  |  |  |', 2],
  ]

  it('кнопки панели (mdInsert)', () => {
    for (const md of DOCS) {
      for (const ed of [null, ...ranges(md)]) {
        for (const [text, caret] of TOOLS) {
          const m = mockup(md, ed)
          m.h.mdInsert('w:x', text, caret)
          const mine = insertBlock(md, ed, text, caret)
          const label = `${JSON.stringify(md)} ${JSON.stringify(ed)} ${JSON.stringify(text)}`
          expect({ md: mine.md, edit: mine.edit, caret: mine.caret }, label).toEqual(m.outcome())
        }
      }
    }
  })

  it('«+ Добавить блок» (mdAppend)', () => {
    for (const md of DOCS) {
      const m = mockup(md, null)
      m.h.mdAppend('w:x')
      const mine = append(md)
      expect({ md: mine.md, edit: mine.edit, caret: mine.caret }, JSON.stringify(md)).toEqual(m.outcome())
    }
  })

  it('Enter по границе (mdSplit)', () => {
    for (const md of DOCS) {
      for (const ed of ranges(md)) {
        for (const [before, after] of [['а', 'б'], ['а', ''], ['', 'б'], ['', '']]) {
          const m = mockup(md, ed)
          m.h.mdSplit('w:x', { ...ed, key: 'w:x', t: 1 }, before, after)
          const mine = split(md, ed, before, after)
          expect({ md: mine.md, edit: mine.edit, caret: mine.caret }, JSON.stringify([md, ed, before, after])).toEqual(
            m.outcome(),
          )
        }
      }
    }
  })

  it('галочки (mdToggle)', () => {
    for (const md of DOCS) {
      md.split('\n').forEach((_, line) => {
        const m = mockup(md, null)
        m.h.mdToggle('w:x', line)
        expect(toggleCheck(md, line), JSON.stringify([md, line])).toBe(m.outcome().md)
      })
    }
  })
})
