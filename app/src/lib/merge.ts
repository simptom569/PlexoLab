// Слияние двух правок одного текста «как в git» (diff3), по строкам.
//
// Есть общая основа (то, что оба видели последним), моя версия и чужая. Правки каждой стороны относительно основы
// складываются, если они не пересекаются. Строго, как в git: правки считаются пересекающимися, если задевают одни и те же
// строки или стоят вплотную (соседние строки, две вставки в одно место). Тогда слияния нет, и вызывающий показывает
// человеку выбор. Одинаковые правки с обеих сторон принимаются один раз.
//
// Одно улучшение сверх git: вставку (и удаление) блока можно «сдвинуть» через равные строки, например через пустую строку
// между абзацами. Один и тот же новый абзац описывается двумя способами («после абзаца 4» и «перед абзацем 5»), и
// без сдвига вставка между абзацами давала бы ложный конфликт с правкой любого из соседей.

/** Строки основы `[start, end)` заменены строками `lines` */
export type Hunk = { start: number; end: number; lines: string[] }

/** Сравнение строк стоит памяти n×m: для очень больших тексов слияние не пробуем, остаётся выбор человека */
const MAX_CELLS = 4_000_000

const sameLines = (a: string[], b: string[]) => a.length === b.length && a.every((line, i) => line === b[i])
const same = (a: Hunk, b: Hunk) => a.start === b.start && a.end === b.end && sameLines(a.lines, b.lines)

/** Правки `other` относительно `base`; `null`, если тексты слишком велики для сравнения */
export function diffLines(base: string[], other: string[]): Hunk[] | null {
  let head = 0
  while (head < base.length && head < other.length && base[head] === other[head]) head++
  let baseEnd = base.length
  let otherEnd = other.length
  while (baseEnd > head && otherEnd > head && base[baseEnd - 1] === other[otherEnd - 1]) {
    baseEnd--
    otherEnd--
  }
  const n = baseEnd - head
  const m = otherEnd - head
  if (n === 0 && m === 0) return []
  if (n === 0) return [{ start: head, end: head, lines: other.slice(head, otherEnd) }]
  if (m === 0) return [{ start: head, end: baseEnd, lines: [] }]
  if ((n + 1) * (m + 1) > MAX_CELLS) return null

  // lcs[i][j]: длина наибольшей общей части хвостов base[head+i..] и other[head+j..]
  const w = m + 1
  const lcs = new Int32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = base[head + i] === other[head + j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1])
    }
  }

  const hunks: Hunk[] = []
  let cur: Hunk | null = null
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && base[head + i] === other[head + j]) {
      if (cur) hunks.push(cur)
      cur = null
      i++
      j++
    } else if (i < n && (j === m || lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) {
      cur ??= { start: head + i, end: head + i, lines: [] }
      i++
      cur.end = head + i
    } else {
      cur ??= { start: head + i, end: head + i, lines: [] }
      cur.lines.push(other[head + j])
      j++
    }
  }
  if (cur) hunks.push(cur)
  return hunks
}

/**
 * Равноценные описания одной правки, исходное первым. Чистая вставка или чистое удаление сдвигаются через равные строки,
 * но не дальше соседних правок той же стороны (`floor` и `ceil`). Замена строк описывается одним способом.
 */
function alternatives(base: string[], hunk: Hunk, floor: number, ceil: number): Hunk[] {
  const out: Hunk[] = [hunk]
  if (hunk.lines.length > 0 && hunk.start === hunk.end) {
    // вставка: вверх, пока предыдущая строка основы равна последней вставленной; вниз, пока следующая равна первой
    let up = hunk
    while (up.start > floor && base[up.start - 1] === up.lines[up.lines.length - 1]) {
      up = { start: up.start - 1, end: up.end - 1, lines: [up.lines[up.lines.length - 1], ...up.lines.slice(0, -1)] }
      out.push(up)
    }
    let down = hunk
    while (down.start < ceil && base[down.start] === down.lines[0]) {
      down = { start: down.start + 1, end: down.end + 1, lines: [...down.lines.slice(1), down.lines[0]] }
      out.push(down)
    }
  } else if (hunk.lines.length === 0 && hunk.end > hunk.start) {
    // удаление: вверх, пока строка перед ним равна его последней строке; вниз, пока следующая равна первой
    let up = hunk
    while (up.start > floor && base[up.start - 1] === base[up.end - 1]) {
      up = { start: up.start - 1, end: up.end - 1, lines: [] }
      out.push(up)
    }
    let down = hunk
    while (down.end < ceil && base[down.start] === base[down.end]) {
      down = { start: down.start + 1, end: down.end + 1, lines: [] }
      out.push(down)
    }
  }
  return out
}

/** Правки пересекаются или стоят вплотную: общая строка, соседние строки, две вставки в одно место */
const touches = (a: Hunk, b: Hunk) => a.start <= b.end && b.start <= a.end

type Item = { alts: Hunk[]; chosen: Hunk; twin: Item | null }

function items(base: string[], hunks: Hunk[]): Item[] {
  return hunks.map((h, i) => {
    const alts = alternatives(base, h, hunks[i - 1]?.end ?? 0, hunks[i + 1]?.start ?? base.length)
    return { alts, chosen: h, twin: null }
  })
}

/** Выбирает такое описание правки, которое не задевает правки другой стороны; если такого нет, остаётся исходное */
function settle(item: Item, others: Item[]) {
  if (item.twin) return
  for (const alt of item.alts) {
    if (others.every((o) => !touches(alt, o.chosen))) {
      item.chosen = alt
      return
    }
  }
}

const equivalent = (a: Item, b: Item) => a.alts.some((x) => b.alts.some((y) => same(x, y)))

const isInsertion = (h: Hunk) => h.start === h.end && h.lines.length > 0

/**
 * Две разные вставки в одно место: у них есть общее равноценное положение (например, обе «между абзацами 4 и 5»).
 * Сдвиг нужен, чтобы вставка не конфликтовала с правкой соседа, а не чтобы разводить две вставки: как в git, это конфликт.
 */
const sameSpot = (a: Item, b: Item) => isInsertion(a.chosen) && isInsertion(b.chosen) && a.alts.some((x) => b.alts.some((y) => x.start === y.start))

export type Merge3 = {
  lines: string[]
  /** Для каждой строки моей версии: где она оказалась в результате, или -1, если чужая правка её убрала */
  map: number[]
}

const isFence = (line: string) => /^```/.test(line)

/**
 * На сколько правка меняет число строк-ограждений кода. Нечётное значение: правка убрала или добавила одно ограждение, и
 * блок кода «поплыл» (его конец стал концом чужого блока); с чужой правкой рядом такое склеивать нельзя.
 */
const fenceDelta = (base: string[], h: Hunk) => h.lines.filter(isFence).length - base.slice(h.start, h.end).filter(isFence).length

/** Сливает правки; `null`, если они пересекаются, ломают блок кода или тексты слишком велики */
export function merge3(base: string[], mine: string[], theirs: string[]): Merge3 | null {
  const hunksMine = diffLines(base, mine)
  const hunksTheirs = diffLines(base, theirs)
  if (!hunksMine || !hunksTheirs) return null
  if ([...hunksMine, ...hunksTheirs].some((h) => fenceDelta(base, h) % 2 !== 0)) return null
  const a = items(base, hunksMine)
  const b = items(base, hunksTheirs)

  // одинаковые правки с обеих сторон принимаются один раз
  for (const x of a) {
    const y = b.find((c) => c.twin === null && equivalent(x, c))
    if (y) {
      x.twin = y
      y.twin = x
    }
  }
  for (const x of a) settle(x, b)
  for (const y of b) settle(y, a)

  for (const x of a) {
    for (const y of b) if (x.twin !== y && (touches(x.chosen, y.chosen) || sameSpot(x, y))) return null
  }
  // соседние правки одной стороны после сдвигов не должны налезать друг на друга
  for (const side of [a, b]) {
    for (let k = 1; k < side.length; k++) if (side[k].chosen.start < side[k - 1].chosen.end) return null
  }

  // мои правки и чужие, не совпавшие с моими, по порядку в основе
  const order = [...a.map((x) => x.chosen), ...b.filter((y) => y.twin === null).map((y) => y.chosen)].sort((p, q) => p.start - q.start || p.end - q.end)
  const mineSet = new Set(a.map((x) => x.chosen))

  const out: string[] = []
  const map: number[] = []
  let pos = 0
  const keep = (to: number) => {
    for (; pos < to; pos++) {
      map.push(out.length)
      out.push(base[pos])
    }
  }
  for (const hunk of order) {
    keep(hunk.start)
    if (mineSet.has(hunk)) {
      for (const line of hunk.lines) {
        map.push(out.length)
        out.push(line)
      }
    } else {
      // чужая правка: этих строк основы в моей версии не менялось, но теперь их заменили
      for (let k = hunk.start; k < hunk.end; k++) map.push(-1)
      out.push(...hunk.lines)
    }
    pos = hunk.end
  }
  keep(base.length)
  return map.length === mine.length ? { lines: out, map } : null
}

export type MergedText = { md: string; map: number[] }

/**
 * Слияние текста: `base` последнее, что человек видел на сервере, `mine` его текст сейчас, `theirs` версия на сервере.
 * `null`, если слить нельзя или результат подозрителен: тогда человек выбирает сам.
 */
export function mergeText(base: string, mine: string, theirs: string): MergedText | null {
  const mineLines = mine.split('\n')
  if (mine === theirs || theirs === base) return { md: mine, map: mineLines.map((_, i) => i) }
  const baseLines = base.split('\n')
  const theirLines = theirs.split('\n')
  const merged = merge3(baseLines, mineLines, theirLines)
  return merged && { md: merged.lines.join('\n'), map: merged.map }
}

/** Куда перешёл блок строк `[start, end)` моей версии; `null`, если все его строки убрала чужая правка */
export function mapRange(map: number[], start: number, end: number): { start: number; end: number } | null {
  let first = -1
  let last = -1
  for (let i = start; i < end && i < map.length; i++) {
    if (map[i] < 0) continue
    if (first < 0) first = map[i]
    last = map[i]
  }
  return first < 0 ? null : { start: first, end: last + 1 }
}
