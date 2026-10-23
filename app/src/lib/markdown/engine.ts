// Markdown в стиле Obsidian: разбор. Порт design/reference/markdown-engine.js без изменения поведения.
// Текст документа — одна строка, блок — диапазон строк [start, end), блоки разделены пустыми строками.

export const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/
const BLOCK_START = /^(```|#{1,3}\s|\||>|(-{3,}|\*{3,})\s*$)/

export const startsBlock = (line: string) => BLOCK_START.test(line) || LIST_RE.test(line)

/** Сколько строк занимает текст в поле ввода (78 знаков на строку) */
export const rowsFor = (text: string) =>
  Math.max(1, String(text || '').split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 78)), 0))

/** Заголовки выносок `> [!tip]` без собственного названия */
export const CALLOUT: Record<string, string> = {
  note: 'Заметка',
  tip: 'Совет',
  warning: 'Важно',
  info: 'Информация',
  todo: 'Сделать',
  bug: 'Ошибка',
}

export type BlockKind = 'p' | 'code' | 'h1' | 'h2' | 'h3' | 'hr' | 'table' | 'quote' | 'list'

export type Block = { kind: BlockKind; start: number; end: number }

/** Делит строки на блоки; пустые строки только разделяют блоки. `off` прибавляется к номерам строк. */
export function mdBlocks(lines: string[], off = 0): Block[] {
  const out: Block[] = []
  const n = lines.length
  let i = 0
  while (i < n) {
    const l = lines[i]
    if (!l.trim()) {
      i++
      continue
    }
    let j = i + 1
    let kind: BlockKind = 'p'
    if (/^```/.test(l)) {
      kind = 'code'
      while (j < n && !/^```/.test(lines[j])) j++
      j = Math.min(n, j + 1)
    } else if (/^#{1,3}\s/.test(l)) kind = `h${/^#+/.exec(l)![0].length}` as BlockKind
    else if (/^(-{3,}|\*{3,})\s*$/.test(l)) kind = 'hr'
    else if (/^\|/.test(l)) {
      kind = 'table'
      while (j < n && /^\|/.test(lines[j])) j++
    } else if (/^>/.test(l)) {
      kind = 'quote'
      while (j < n && /^>/.test(lines[j])) j++
    } else if (LIST_RE.test(l)) {
      kind = 'list'
      while (j < n && lines[j].trim() && LIST_RE.test(lines[j])) j++
    } else {
      while (j < n && lines[j].trim() && !startsBlock(lines[j])) j++
    }
    out.push({ kind, start: off + i, end: off + j })
    i = j
  }
  return out
}

/** Тип первого блока в тексте (пустой текст — абзац) */
export const mdKindOf = (text: string): BlockKind => (mdBlocks(text.split('\n'), 0)[0] || { kind: 'p' }).kind

/** Убирает пустые маркеры и лишние пустые строки после выхода из редактирования */
export const mdTidy = (md: string) =>
  md
    .replace(/^(?:#{1,3}|[-*+]|\d+[.)]|>|[-*+]\s\[[ xX]\])[ \t]*$/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')

const EMPTY_MARKER = /^(?:#{1,3}|[-*+]|\d+[.)]|>|[-*+]\s\[[ xX]\])[ \t]*$/

/**
 * То же, что `mdTidy`, но только вокруг блока строк `[start, end)`, из которого человек вышел. Чужой пустой блок или
 * свежий маркер `-`, который другой человек только что вставил, лежат в общем тексте, и очистка всего документа стирала
 * их у него из-под рук. Пустые строки вокруг блока трогаются, только если блок сам начинается или кончается пустой
 * строкой (пустой новый блок, лишний Enter): тогда схлопывается вся примыкающая пустота, как в `mdTidy`.
 * Одна пустая строка в самом начале или конце текста — остаток после удаления соседнего блока (Backspace на пустом):
 * она убирается. Чужой пустой блок там занимает минимум две пустые строки, его это не касается.
 */
export function mdTidyBlock(md: string, start: number, end: number): string {
  const lines = md.split('\n')
  let a = Math.min(Math.max(start, 0), lines.length)
  let b = Math.min(Math.max(end, a), lines.length)
  for (let i = a; i < b; i++) lines[i] = EMPTY_MARKER.test(lines[i]) ? '' : lines[i].replace(/[ \t]+$/, '')
  if (a === b) return lines.join('\n')

  const blank = (i: number) => lines[i].trim() === ''
  if (blank(a)) while (a > 0 && blank(a - 1)) a--
  if (blank(b - 1)) while (b < lines.length && blank(b)) b++

  // подряд идущие пустые строки внутри куска становятся одной; в самом начале и конце текста пустота исчезает совсем
  const kept: string[] = []
  for (let i = a; i < b; i++) {
    if (!blank(i)) kept.push(lines[i])
    else if (kept.length === 0 ? a > 0 : kept[kept.length - 1] !== '') kept.push('')
  }
  if (b === lines.length && kept[kept.length - 1] === '') kept.pop()
  let head = lines.slice(0, a)
  let tail = lines.slice(b)
  if (head.length === 1 && blank(0)) head = []
  if (tail.length === 1 && blank(b)) tail = []
  return [...head, ...kept, ...tail].join('\n')
}

/** Кусок строки: обычный текст (`cls` пустой), жирный `b`, курсив `i`, зачёркнутый `s`, код `c`, страница вики `wl`, ссылка `lk`, тег `tg` */
export type Inline = { t: string; cls: '' | 'b' | 'i' | 's' | 'c' | 'wl' | 'lk' | 'tg'; wiki?: string; url?: string }

// **жирный**, *курсив*, ~~зачёркнутый~~, `код`, [[страница]], [текст](адрес), #тег
const INLINE_SRC =
  '\\*\\*[^*]+\\*\\*|~~[^~]+~~|\\*[^*\\s][^*]*\\*|`[^`]+`|\\[\\[[^\\]]+\\]\\]|\\[[^\\]]+\\]\\([^)\\s]+\\)|#[\\p{L}\\d_\\/-]+'

/** Разбор строки на куски. Пустая строка даёт один кусок из неразрывного пробела, чтобы строка в разметке не схлопнулась. */
export function mdInline(t: string): Inline[] {
  const out: Inline[] = []
  const re = new RegExp(INLINE_SRC, 'gu')
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    const s = m[0]
    const i = m.index
    if (s[0] === '#' && i > 0 && !/\s/.test(t[i - 1])) continue
    if (i > last) out.push({ t: t.slice(last, i), cls: '' })
    if (s.slice(0, 2) === '**') out.push({ t: s.slice(2, -2), cls: 'b' })
    else if (s.slice(0, 2) === '~~') out.push({ t: s.slice(2, -2), cls: 's' })
    else if (s.slice(0, 2) === '[[') {
      const body = s.slice(2, -2).split('|')
      out.push({ t: (body[1] || body[0]).trim(), cls: 'wl', wiki: body[0].trim() })
    } else if (s[0] === '*') out.push({ t: s.slice(1, -1), cls: 'i' })
    else if (s[0] === '`') out.push({ t: s.slice(1, -1), cls: 'c' })
    else if (s[0] === '[') {
      const k = s.indexOf('](')
      out.push({ t: s.slice(1, k), cls: 'lk', url: s.slice(k + 2, -1) })
    } else out.push({ t: s, cls: 'tg' })
    last = i + s.length
  }
  if (last < t.length) out.push({ t: t.slice(last), cls: '' })
  if (!out.length) out.push({ t: '\u00a0', cls: '' })
  return out
}
