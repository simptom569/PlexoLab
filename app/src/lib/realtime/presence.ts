// Присутствие: кто сейчас в каком блоке страницы вики или документа. Две половины.
//
// 1. Чужие метки (`usePresence`): что сервер сообщил о других людях. Метка говорит «человек в строках [start, end) текста
//    версии rev»; а у меня текст может быть другим (я его правлю, сосед что-то вставил выше), поэтому `placeMarks` заново
//    считает, где этот блок у меня сейчас (тем же `trackBlock`, что сдвигает мой открытый блок при чужих правках).
// 2. Своя метка (`announcer`): редактор сообщает, какой блок открыт, а объявитель решает, когда рассказать об этом
//    серверу: не чаще, чем раз в `SEND_DELAY_MS`, пока блок открыт и окно в работе подтверждает раз в `KEEPALIVE_MS`,
//    когда человек отошёл или окно потеряло фокус, сам снимает метку.
// Протокол описан в server/crates/api/src/ws.rs.

import { create } from 'zustand'
import { trackBlock } from '../merge'
import type { PresenceMark } from './events'

// ----- чужие метки -----

/** Метка и порядок прихода: чем больше `seq`, тем позже человек сдвинулся */
export type StoredMark = PresenceMark & { seq: number }

type PresenceState = {
  /** По подключению (`client`): у одного человека их может быть несколько */
  marks: Record<string, StoredMark>
  seq: number
  /** Список целиком (сразу после `ready`): заменяет всё, что было */
  replaceAll: (marks: PresenceMark[]) => void
  set: (mark: PresenceMark) => void
  gone: (client: string) => void
  clear: () => void
}

const samePlace = (a: PresenceMark, b: PresenceMark) =>
  a.user_id === b.user_id && a.kind === b.kind && a.id === b.id && a.rev === b.rev && a.start === b.start && a.end === b.end

export const usePresence = create<PresenceState>()((set) => ({
  marks: {},
  seq: 0,
  replaceAll: (list) =>
    set((s) => {
      let seq = s.seq
      const marks: Record<string, StoredMark> = {}
      for (const m of list) {
        const old = s.marks[m.client]
        marks[m.client] = old && samePlace(old, m) ? old : { ...m, seq: ++seq }
      }
      return { marks, seq }
    }),
  set: (mark) =>
    set((s) => {
      const old = s.marks[mark.client]
      if (old && samePlace(old, mark)) return s
      return { marks: { ...s.marks, [mark.client]: { ...mark, seq: s.seq + 1 } }, seq: s.seq + 1 }
    }),
  gone: (client) =>
    set((s) => {
      if (!(client in s.marks)) return s
      const { [client]: _gone, ...marks } = s.marks
      return { marks }
    }),
  clear: () => set((s) => (Object.keys(s.marks).length ? { marks: {} } : s)),
}))

/** Метки на этой странице: по одной на человека (там, где он двигался последним), в порядке прихода */
export function marksOnPage(marks: Record<string, StoredMark>, kind: 'wiki' | 'doc', id: string): StoredMark[] {
  const latest = new Map<string, StoredMark>()
  for (const m of Object.values(marks)) {
    if (m.kind !== kind || m.id !== id) continue
    const prev = latest.get(m.user_id)
    if (!prev || m.seq > prev.seq) latest.set(m.user_id, m)
  }
  return [...latest.values()].sort((a, b) => a.seq - b.seq)
}

/** Где блок метки у меня сейчас: строки `[start, end)` показанного мной текста, `null` — блока в нём больше нет */
export type Place = { start: number; end: number }

/**
 * Номера строк в метке относятся к тексту версии `mark.rev`. Если у меня другой текст, блок ищется заново: как он
 * сместился между той версией и тем, что у меня на экране. Версию, которой у меня нет (слишком старая или ещё не
 * дошла), знать нечем: тогда берутся номера как есть, а точнее станет, когда придёт новая версия или метка.
 */
export function placeMark(mark: { rev: number; start: number; end: number }, md: string, textAt: (rev: number) => string | undefined): Place | null {
  const lines = md.split('\n').length
  const fit = (p: Place): Place | null => (p.start < lines ? { start: p.start, end: Math.min(p.end, lines) } : null)
  const base = textAt(mark.rev)
  if (base === undefined || base === md) return fit({ start: mark.start, end: mark.end })
  const moved = trackBlock(base, md, mark.start, mark.end)
  return moved && fit(moved)
}

/** Человек, которого видно по метке */
export type Person = { name: string; tone: number }

/** Метка для редактора: кто, каким цветом, в каких строках */
export type PlacedMark = Place & { key: string; name: string; tone: number }

/** «Лена Крылова» → «Лена» */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] || name

/**
 * Метки страницы для редактора. Человека, которого в списке пока нет, показываем безымянным: лучше знать, что в блоке
 * кто-то есть, чем не знать ничего.
 */
export function placeMarks(
  marks: StoredMark[],
  people: ReadonlyMap<string, Person>,
  md: string,
  textAt: (rev: number) => string | undefined,
): PlacedMark[] {
  const out: PlacedMark[] = []
  for (const m of marks) {
    const place = placeMark(m, md, textAt)
    if (!place) continue
    const person = people.get(m.user_id)
    out.push({ key: m.user_id, name: person ? firstName(person.name) : 'Участник', tone: person?.tone ?? 0, ...place })
  }
  return out
}

/** Блок текста на экране: строки `[start, end)` (отрисованный блок или тот, что открыт на правку) */
export type Span = { start: number; end: number }

/**
 * Какая метка в каком блоке. `inBlock[i]` — метки блока `i`: первый блок, пересекающийся со строками метки. Метка, под
 * которой нет ни одного блока (строки пустые: человек только что вставил блок и ничего не написал), попадает в
 * `inGap`: `inGap[i]` — между блоком `i - 1` и блоком `i`, последний элемент — после всех блоков.
 */
export function assignMarks(marks: PlacedMark[], blocks: Span[]): { inBlock: PlacedMark[][]; inGap: PlacedMark[][] } {
  const inBlock: PlacedMark[][] = blocks.map(() => [])
  const inGap: PlacedMark[][] = Array.from({ length: blocks.length + 1 }, () => [])
  for (const m of marks) {
    const at = blocks.findIndex((b) => b.start < m.end && b.end > m.start)
    if (at >= 0) inBlock[at]!.push(m)
    else {
      const next = blocks.findIndex((b) => b.start > m.start)
      inGap[next < 0 ? blocks.length : next]!.push(m)
    }
  }
  return { inBlock, inGap }
}

// ----- своя метка -----

/** Что сообщается: блок строк `[start, end)` текста версии `rev` на странице вики или в документе */
export type Position = { kind: 'wiki' | 'doc'; id: string; rev: number; start: number; end: number }

/** Сколько ждать после последнего движения, прежде чем сообщить: стрелки, зажатые в списке блоков, дают один пакет */
export const SEND_DELAY_MS = 250
/** Как часто подтверждать место, пока человек в блоке (сервер снимает метку, которую 45 секунд не подтверждали) */
export const KEEPALIVE_MS = 15_000
/** Сколько человек может ничего не нажимать и не двигать мышью в окне, прежде чем метка снимется (отошёл) */
export const AFK_MS = 120_000

const samePosition = (a: Position | null, b: Position | null) =>
  a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id && a.rev === b.rev && a.start === b.start && a.end === b.end)

export type AnnouncerEnv = {
  now: () => number
  /** Окно на виду и в фокусе */
  active: () => boolean
}

const browserEnv: AnnouncerEnv = {
  now: () => Date.now(),
  active: () => typeof document === 'undefined' || (document.visibilityState === 'visible' && document.hasFocus()),
}

const INPUT_EVENTS = ['keydown', 'pointerdown', 'pointermove', 'wheel'] as const

export class PresenceAnnouncer {
  private readonly env: AnnouncerEnv
  private send: ((message: unknown) => boolean) | null = null
  private enabled = true
  /** Где человек сейчас по словам редактора */
  private target: Position | null = null
  /** Что известно серверу */
  private sent: Position | null = null
  private lastInput: number
  /** Метка снята, потому что человек отошёл: первое же нажатие вернёт её */
  private idle = false
  private delay: ReturnType<typeof setTimeout> | undefined
  private keepalive: ReturnType<typeof setInterval> | undefined

  constructor(env: AnnouncerEnv = browserEnv) {
    this.env = env
    this.lastInput = env.now()
  }

  /** Связь есть (`send` ответит `false`, пока соединение не открыто) и можно слушать окно */
  attach(send: (message: unknown) => boolean): void {
    this.send = send
    this.sent = null
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', this.onWindow)
      window.addEventListener('blur', this.onWindow)
      document.addEventListener('visibilitychange', this.onWindow)
      for (const type of INPUT_EVENTS) window.addEventListener(type, this.touch, { capture: true, passive: true })
    }
  }

  detach(): void {
    this.send = null
    this.sent = null
    this.stopKeepalive()
    clearTimeout(this.delay)
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', this.onWindow)
      window.removeEventListener('blur', this.onWindow)
      document.removeEventListener('visibilitychange', this.onWindow)
      for (const type of INPUT_EVENTS) window.removeEventListener(type, this.touch, { capture: true })
    }
  }

  /** Сервер ответил `ready`: о нас он не знает ничего, и если человек в блоке, надо сказать заново */
  ready(): void {
    this.sent = null
    this.sync()
  }

  /** Связь пропала: сервер снял метку сам */
  lost(): void {
    this.sent = null
    this.stopKeepalive()
  }

  /** Настройка «Показывать, где правят другие»: выключено — не сообщаем ничего */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return
    this.enabled = enabled
    this.sync()
  }

  /** Редактор: человек в этом блоке (`null` — ни в каком). Сообщается с небольшой задержкой. */
  set(target: Position | null): void {
    if (samePosition(target, this.target)) return
    this.target = target
    clearTimeout(this.delay)
    this.delay = setTimeout(() => this.sync(), SEND_DELAY_MS)
  }

  // ----- внутреннее -----

  private readonly onWindow = () => this.sync()

  /** Человек что-то нажал или двинул мышью (слушатель окна; доступен снаружи для тестов) */
  readonly touch = () => {
    this.lastInput = this.env.now()
    if (this.idle) {
      this.idle = false
      this.sync()
    }
  }

  private away(): boolean {
    return this.env.now() - this.lastInput > AFK_MS
  }

  /** Приводит сказанное серверу к тому, что должно быть сейчас */
  private sync(): void {
    clearTimeout(this.delay)
    const away = this.away()
    if (away) this.idle = true
    const want = this.send && this.enabled && this.target && this.env.active() && !away ? this.target : null
    if (samePosition(want, this.sent)) return
    if (want) {
      if (this.send?.({ type: 'focus', ...want })) {
        this.sent = want
        this.startKeepalive()
      }
    } else if (this.sent) {
      this.send?.({ type: 'blur' })
      this.sent = null
      this.stopKeepalive()
    }
  }

  private startKeepalive() {
    if (this.keepalive) return
    this.keepalive = setInterval(() => {
      const sent = this.sent
      if (!sent) return this.stopKeepalive()
      // отошёл, окно потеряло фокус, настройку выключили: метку надо снять, а не подтверждать
      if (this.away() || !this.enabled || !this.env.active()) return this.sync()
      this.send?.({ type: 'focus', ...sent })
    }, KEEPALIVE_MS)
  }

  private stopKeepalive() {
    clearInterval(this.keepalive)
    this.keepalive = undefined
  }
}

/** Единственный объявитель приложения: его подключает `startRealtime` */
export const announcer = new PresenceAnnouncer()
