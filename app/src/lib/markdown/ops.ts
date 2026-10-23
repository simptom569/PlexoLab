// Правки текста редактора как чистые функции. Порт методов `md*` макета: вся логика клавиш и вставки блоков здесь,
// компоненту остаются фокус, выделение и события браузера.

import { LIST_RE, mdBlocks, mdKindOf, mdTidyBlock, type Block } from './engine'

/** Активный блок: строки [start, end) показаны исходником */
export type Edit = { start: number; end: number }

/**
 * Результат правки: новый текст, какой блок теперь активен (`null` — никакой) и где поставить курсор:
 * `undefined` — не трогать, `null` — в конец блока, число — позиция в тексте блока.
 */
export type Step = { md: string; edit: Edit | null; caret?: number | null }

/** Вставляет `text` отдельным блоком после строки `e`, оставляя пустые строки вокруг. Меняет `lines`. */
function insertAt(lines: string[], e: number, text: string): Edit {
  let at = e
  if (at < lines.length && lines[at].trim() === '') at++
  else {
    lines.splice(at, 0, '')
    at++
  }
  const tl = text.split('\n')
  lines.splice(at, 0, ...tl)
  const after = at + tl.length
  if (after < lines.length && lines[after].trim() !== '') lines.splice(after, 0, '')
  return { start: at, end: at + tl.length }
}

/** Конец текста без хвоста из пустых строк */
function contentEnd(lines: string[]) {
  let e = lines.length
  while (e > 0 && lines[e - 1].trim() === '') e--
  return e
}

/**
 * Выход из редактирования блока `ed`: очистка текста (`mdFinish`). В макете она идёт по всему тексту; здесь только
 * вокруг этого блока, иначе она стирала бы у другого человека его только что вставленный пустой блок (см. `mdTidyBlock`).
 */
export function finish(md: string, ed: Edit | null): Step {
  return { md: ed ? mdTidyBlock(md, ed.start, ed.end) : md, edit: null }
}

/** Заменяет текст активного блока (`mdPut`); вызывается на каждый символ */
export function put(md: string, ed: Edit, text: string, caret?: number): Step {
  const lines = md.split('\n')
  const nl = text.split('\n')
  lines.splice(ed.start, ed.end - ed.start, ...nl)
  return { md: lines.join('\n'), edit: { start: ed.start, end: ed.start + nl.length }, caret }
}

/** Enter: до курсора остаётся в блоке, после курсора уходит в новый блок (`mdSplit`) */
export function split(md: string, ed: Edit, before: string, after: string): Step {
  const lines = md.split('\n')
  const bl = before.split('\n')
  lines.splice(ed.start, ed.end - ed.start, ...bl)
  const at = insertAt(lines, ed.start + bl.length, after)
  return { md: lines.join('\n'), edit: at, caret: 0 }
}

/** Новый пустой блок в конце документа (`mdAppend`) */
export function append(md: string): Step {
  const lines = md.split('\n')
  const e = contentEnd(lines)
  if (e === 0) return { md, edit: { start: 0, end: 1 }, caret: 0 }
  const at = insertAt(lines, e, '')
  return { md: lines.join('\n'), edit: at, caret: 0 }
}

/**
 * Кнопки панели: новый блок после активного, вместо пустого активного или в конец документа (`mdInsert`).
 * `caret` — куда поставить курсор в новом блоке, по умолчанию в конец вставленного текста.
 */
export function insertBlock(md: string, ed: Edit | null, text: string, caret?: number): Step {
  const lines = md.split('\n')
  const at = caret == null ? text.length : caret
  if (ed) {
    if (lines.slice(ed.start, ed.end).join('\n').trim() === '') return put(md, ed, text, at)
    const placed = insertAt(lines, ed.end, text)
    return { md: lines.join('\n'), edit: placed, caret: at }
  }
  const e = contentEnd(lines)
  if (e === 0) return { md: text, edit: { start: 0, end: text.split('\n').length }, caret: at }
  const placed = insertAt(lines, e, text)
  return { md: lines.join('\n'), edit: placed, caret: at }
}

/** Оборачивает выделение в `a` и `b` (`mdWrap`). Без выделения вставляет слово «текст». */
export function wrap(value: string, selStart: number, selEnd: number, a: string, b: string) {
  const mid = value.slice(selStart, selEnd) || 'текст'
  return {
    text: value.slice(0, selStart) + a + mid + b + value.slice(selEnd),
    caret: selStart + a.length + mid.length + b.length,
  }
}

/** Переключает галочку `- [ ]` ↔ `- [x]` в строке `line` (`mdToggle`) */
export function toggleCheck(md: string, line: number): string {
  const lines = md.split('\n')
  lines[line] = lines[line].replace(/\[( |x|X)\]/, (_m, c: string) => (c === ' ' ? '[x]' : '[ ]'))
  return lines.join('\n')
}

/** Что известно о нажатой клавише и текстовом поле активного блока */
export type KeyInput = {
  key: string
  shift: boolean
  /** Ctrl или Cmd */
  mod: boolean
  value: string
  selStart: number
  selEnd: number
}

/** `prevent` — отменить действие браузера; `step` — что сделать с текстом */
export type KeyResult = { prevent: boolean; step: Step }

const range = (b: Block): Edit => ({ start: b.start, end: b.end })

/**
 * Клавиши внутри активного блока (`mdKey`). `null` — клавиша не наша, всё делает браузер.
 * Enter, Backspace на пустом блоке, стрелки на краях, Tab, Ctrl+B / Ctrl+I, Esc и Ctrl+Enter.
 */
export function keyAction(md: string, ed: Edit, k: KeyInput): KeyResult | null {
  const { key, shift, mod, value: val, selStart: p } = k
  const sel = k.selEnd !== p
  const lower = String(key).toLowerCase()
  const handled = (step: Step): KeyResult => ({ prevent: true, step })
  const go = (b: Block, caret: number | null): Step => ({ md, edit: range(b), caret })

  if (key === 'Escape' || (mod && key === 'Enter')) return handled(finish(md, ed))
  const wrapWith = (a: string, b: string) => {
    const w = wrap(val, k.selStart, k.selEnd, a, b)
    return handled(put(md, ed, w.text, w.caret))
  }
  if (mod && lower === 'b') return wrapWith('**', '**')
  if (mod && lower === 'i') return wrapWith('*', '*')

  const kind = mdKindOf(val)
  const ls = p === 0 ? 0 : val.lastIndexOf('\n', p - 1) + 1
  let le = val.indexOf('\n', p)
  if (le < 0) le = val.length
  const cur = val.slice(ls, le)

  if (key === 'Enter' && !shift) {
    if (kind === 'code') {
      // внутри кода Enter ставит перенос, после закрывающей ``` создаёт новый блок
      if (!(/\n```\s*$/.test(val) && p === val.length)) return null
      return handled(split(md, ed, val, ''))
    }
    const leave = () => handled(split(md, ed, val.slice(0, ls).replace(/\n$/, ''), val.slice(le).replace(/^\n/, '')))
    if (kind === 'list') {
      const m = LIST_RE.exec(cur)
      if (m) {
        if (cur.slice(m[0].length).trim() === '') return leave()
        const num = /^\d/.test(m[2])
        const n = parseInt(m[2], 10)
        const cont = m[1] + (num ? n + 1 + m[2].slice(String(n).length) : m[2]) + ' ' + (m[3] ? '[ ] ' : '')
        return handled(put(md, ed, val.slice(0, p) + '\n' + cont + val.slice(p), p + 1 + cont.length))
      }
    }
    if (kind === 'table' && /^\|/.test(cur)) {
      if (/^\|[\s|]*$/.test(cur)) return leave()
      const cells = Math.max(1, (cur.match(/\|/g) || []).length - 1)
      const row = '|' + '  |'.repeat(cells)
      const nv = val.replace(/\n+$/, '') + '\n' + row
      return handled(put(md, ed, nv, nv.length - row.length + 2))
    }
    return handled(split(md, ed, val.slice(0, p), val.slice(p)))
  }

  if (key === 'Enter' && shift && kind === 'quote') {
    return handled(put(md, ed, val.slice(0, p) + '\n> ' + val.slice(p), p + 3))
  }

  if (key === 'Backspace' && val === '') {
    const lines = md.split('\n')
    lines.splice(ed.start, ed.end - ed.start)
    const prev = mdBlocks(lines.slice(0, ed.start), 0).pop()
    const next = lines.join('\n')
    if (prev) return handled({ md: next, edit: range(prev), caret: null })
    return handled({ md: next, edit: null })
  }

  if (key === 'ArrowUp' && p === 0 && !sel) {
    const prev = mdBlocks(md.split('\n').slice(0, ed.start), 0).pop()
    return prev ? handled(go(prev, null)) : null
  }

  if (key === 'ArrowDown' && p === val.length && !sel) {
    const next = mdBlocks(md.split('\n').slice(ed.end), ed.end)[0]
    return next ? handled(go(next, 0)) : null
  }

  if (key === 'Tab' && kind === 'list') {
    const nl = shift ? cur.replace(/^( {1,2}|\t)/, '') : '  ' + cur
    return handled(put(md, ed, val.slice(0, ls) + nl + val.slice(le), Math.max(ls, p + nl.length - cur.length)))
  }

  return null
}

/** Блок, в который попал курсор после правки, и границы блоков для отрисовки */
export type Segment = Block | { kind: 'edit'; start: number; end: number }

/**
 * Делит текст на сегменты для отрисовки (`vEditor`): блоки до активного, сам активный и блоки после.
 * Если активный блок вышел за пределы текста, активного нет.
 */
export function segments(md: string, ed: Edit | null): { segs: Segment[]; ed: Edit | null; lines: string[] } {
  const lines = md.split('\n')
  if (ed && ed.start >= lines.length) ed = null
  if (!ed) return { segs: mdBlocks(lines, 0), ed: null, lines }
  const a = ed.start
  const b = Math.min(Math.max(ed.end, a + 1), lines.length)
  return {
    segs: [...mdBlocks(lines.slice(0, a), 0), { kind: 'edit', start: a, end: b }, ...mdBlocks(lines.slice(b), b)],
    ed,
    lines,
  }
}
