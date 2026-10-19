// Отрисованный вид блока: что показать для куска текста. Порт `mdView` из макета без привязки к обработчикам.

import { CALLOUT, LIST_RE, mdInline, type Block } from './engine'

/** Кусок строки с готовым классом: у ссылки на несуществующую страницу вики добавлен `miss` */
export type Run = { t: string; cls: string; wiki?: string; url?: string }

export type ListItemView = {
  /** Отступ вложенности в пикселях */
  pad: number
  /** `•` или номер `2.`; у пунктов-задач не показывается */
  dot: string
  isCheck: boolean
  done: boolean
  runs: Run[]
  /** Номер строки пункта в тексте страницы: по нему переключается галочка */
  line: number
}

export type BlockView =
  | { kind: 'text'; cls: string; title?: string; lines: Run[][] }
  | { kind: 'list'; items: ListItemView[] }
  | { kind: 'code'; code: string; lang: string }
  | { kind: 'hr' }
  | { kind: 'table'; cols: number; cells: { head: boolean; runs: Run[] }[] }

/**
 * `lines` — все строки текста, `seg` — блок из `mdBlocks`, `wikiTitles` — названия страниц вики в нижнем регистре
 * (по ним ссылкам `[[...]]` ставится пометка «такой страницы нет»).
 */
export function describeBlock(lines: string[], seg: Block, wikiTitles: string[]): BlockView {
  const src = lines.slice(seg.start, seg.end)
  const k = seg.kind
  const runs = (t: string): Run[] =>
    mdInline(t).map((r) => ({
      ...r,
      cls: r.cls + (r.wiki && wikiTitles.indexOf(r.wiki.toLowerCase()) < 0 ? ' miss' : ''),
    }))
  const lineRuns = (arr: string[]) => arr.map((l) => runs(l))

  if (k === 'h1' || k === 'h2' || k === 'h3') return { kind: 'text', cls: k, lines: lineRuns([src[0].replace(/^#+\s+/, '')]) }

  if (k === 'quote') {
    const body = src.map((l) => l.replace(/^>\s?/, ''))
    const co = /^\[!(\w+)\]\s*(.*)$/.exec(body[0])
    if (co) return { kind: 'text', cls: 'callout', title: co[2] || CALLOUT[co[1].toLowerCase()] || co[1], lines: lineRuns(body.slice(1)) }
    return { kind: 'text', cls: 'quote', lines: lineRuns(body) }
  }

  if (k === 'list') {
    const cnt: Record<number, number> = {}
    const items: ListItemView[] = []
    src.forEach((l, i) => {
      const m = LIST_RE.exec(l)
      if (!m) return
      const ind = Math.floor(m[1].replace(/\t/g, '  ').length / 2)
      const num = /^\d/.test(m[2])
      const chk = m[3] || ''
      Object.keys(cnt).forEach((x) => {
        if (+x > ind) delete cnt[+x]
      })
      if (num) cnt[ind] = (cnt[ind] || 0) + 1
      else delete cnt[ind]
      items.push({
        pad: ind * 22,
        dot: num ? `${cnt[ind]}.` : '•',
        isCheck: !!chk,
        done: /[xX]/.test(chk),
        runs: runs(l.slice(m[0].length)),
        line: seg.start + i,
      })
    })
    return { kind: 'list', items }
  }

  if (k === 'code') {
    const closed = src.length > 1 && /^```\s*$/.test(src[src.length - 1])
    return {
      kind: 'code',
      code: src.slice(1, closed ? src.length - 1 : src.length).join('\n') || ' ',
      lang: src[0].replace(/^```/, '').trim(),
    }
  }

  if (k === 'hr') return { kind: 'hr' }

  if (k === 'table') {
    const rows = src.map((l) =>
      l
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim()),
    )
    const body = rows.filter((r, i) => !(i === 1 && r.every((c) => /^:?-{2,}:?$/.test(c))))
    const cols = Math.max(...body.map((r) => r.length))
    const cells: { head: boolean; runs: Run[] }[] = []
    body.forEach((r, ri) => {
      for (let ci = 0; ci < cols; ci++) cells.push({ head: ri === 0, runs: runs(r[ci] || '') })
    })
    return { kind: 'table', cols, cells }
  }

  return { kind: 'text', cls: 'p', lines: lineRuns(src) }
}
