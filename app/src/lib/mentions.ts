// Упоминания в комментариях (docs/OFFLINE-NOTIFY-SEARCH.md, раздел 2). В тексте на сервере метка `@[id]`, чтобы после
// смены имени старые комментарии показывали новое; на экране при наборе и при чтении `@Имя`. Разбор метки совпадает с
// серверным (server/crates/domain/src/mentions.rs).

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

/** Кусок текста комментария: обычный текст или упоминание человека */
export type Piece = { kind: 'text'; text: string } | { kind: 'mark'; id: string }

/** Режет текст на обычные куски и метки `@[id]` */
export function splitMarks(body: string): Piece[] {
  const out: Piece[] = []
  const re = new RegExp(`@\\[(${UUID})\\]`, 'g')
  let at = 0
  for (const m of body.matchAll(re)) {
    if (m.index > at) out.push({ kind: 'text', text: body.slice(at, m.index) })
    out.push({ kind: 'mark', id: m[1]!.toLowerCase() })
    at = m.index + m[0].length
  }
  if (at < body.length) out.push({ kind: 'text', text: body.slice(at) })
  return out
}

/** Человек, которого можно упомянуть */
export type Mentionable = { id: string; name: string }

/** Упоминание, которое человек набирает сейчас: где стоит `@` и что набрано после него */
export type ActiveMention = { at: number; query: string }

/** Дальше этого набранное после `@` уже не имя */
export const MAX_QUERY = 30

/**
 * Упоминание у курсора. `@` должна стоять в начале текста или после пробела (в `почта@сайт` это не упоминание), а после
 * неё до курсора не должно быть перевода строки. Имя содержит пробел («Лена М.»), поэтому в набранном он допускается.
 */
export function activeMention(text: string, caret: number): ActiveMention | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && !/\s/.test(before[at - 1]!)) return null
  const query = before.slice(at + 1)
  if (query.includes('\n') || query.length > MAX_QUERY) return null
  return { at, query }
}

/**
 * Кого предложить по набранному: имена, начинающиеся с набранного, потом те, где с него начинается любое слово
 * (по «М» найдётся «Лена М.»). Пустой набор показывает первых по списку.
 */
export function filterMentionable<T extends Mentionable>(people: T[], query: string, limit = 6): T[] {
  const q = query.toLowerCase()
  const starts: T[] = []
  const words: T[] = []
  for (const p of people) {
    const name = p.name.toLowerCase()
    if (name.startsWith(q)) starts.push(p)
    else if (q !== '' && !q.includes(' ') && name.split(/\s+/).some((w) => w.startsWith(q))) words.push(p)
  }
  return [...starts, ...words].slice(0, limit)
}

/** Подставляет выбранное имя вместо набранного `@запрос`; возвращает новый текст и место курсора (после имени и пробела) */
export function insertMention(text: string, mention: ActiveMention, caret: number, name: string): { text: string; caret: number } {
  const next = `${text.slice(0, mention.at)}@${name} ${text.slice(caret)}`
  return { text: next, caret: mention.at + 1 + name.length + 1 }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Текст из поля ввода в то, что уходит на сервер: `@Имя` выбранных людей становится меткой `@[id]`. Имя, которое
 * человек потом поправил руками или стёр, меткой не станет и останется обычным текстом. Одинаковые имена у разных людей
 * получают метки в том порядке, в каком их выбирали.
 */
export function toWire(text: string, picked: Mentionable[]): string {
  if (picked.length === 0) return text
  const queues = new Map<string, string[]>()
  for (const p of picked) queues.set(p.name, [...(queues.get(p.name) ?? []), p.id])
  // длинные имена первыми: «Лена М.» не должно съесть начало «Лена М. Петрова»
  const names = [...queues.keys()].sort((a, b) => b.length - a.length)
  const re = new RegExp(`(?<![\\p{L}\\p{N}@])@(${names.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'gu')
  return text.replace(re, (whole, name: string) => {
    const id = queues.get(name)?.shift()
    return id ? `@[${id}]` : whole
  })
}

/** Сколько людей в тексте уже отмечено метками (для подсказки, что их не больше предела сервера) */
export const countMarks = (body: string): number => new Set(splitMarks(body).flatMap((p) => (p.kind === 'mark' ? [p.id] : []))).size
