import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AFK_MS,
  KEEPALIVE_MS,
  PresenceAnnouncer,
  SEND_DELAY_MS,
  assignMarks,
  firstName,
  marksOnPage,
  placeMark,
  placeMarks,
  usePresence,
  type Position,
  type StoredMark,
} from './presence'
import type { PresenceMark } from './events'

const mark = (o: Partial<PresenceMark> = {}): PresenceMark => ({ client: '1', user_id: 'u1', kind: 'wiki', id: 'w1', rev: 1, start: 0, end: 1, ...o })
const stored = (o: Partial<StoredMark> = {}): StoredMark => ({ ...mark(), seq: 1, ...o })
const doc = (...paragraphs: string[]) => paragraphs.join('\n\n')

describe('хранилище чужих меток', () => {
  beforeEach(() => usePresence.setState({ marks: {}, seq: 0 }))
  const marks = () => usePresence.getState().marks

  it('метка ставится по подключению; повтор того же места ничего не меняет', () => {
    usePresence.getState().set(mark())
    const before = usePresence.getState()
    usePresence.getState().set(mark())
    expect(usePresence.getState()).toBe(before)
    expect(Object.keys(marks())).toEqual(['1'])
  })

  it('сдвиг той же метки заменяет её и считается более поздним', () => {
    usePresence.getState().set(mark())
    usePresence.getState().set(mark({ client: '2', user_id: 'u2' }))
    usePresence.getState().set(mark({ start: 4, end: 5 }))
    expect(marks()['1']).toMatchObject({ start: 4, end: 5, seq: 3 })
    expect(Object.keys(marks())).toHaveLength(2)
  })

  it('«ушёл» снимает метку, неизвестное подключение ничего не меняет', () => {
    usePresence.getState().set(mark())
    const before = usePresence.getState()
    usePresence.getState().gone('404')
    expect(usePresence.getState()).toBe(before)
    usePresence.getState().gone('1')
    expect(marks()).toEqual({})
  })

  it('полный список заменяет всё; не изменившиеся метки сохраняют порядок прихода', () => {
    usePresence.getState().set(mark({ client: 'a', user_id: 'ua' }))
    usePresence.getState().set(mark({ client: 'b', user_id: 'ub' }))
    const seqOfA = marks()['a']!.seq
    usePresence.getState().replaceAll([mark({ client: 'a', user_id: 'ua' }), mark({ client: 'c', user_id: 'uc' })])
    expect(Object.keys(marks()).sort()).toEqual(['a', 'c'])
    expect(marks()['a']!.seq).toBe(seqOfA)
    expect(marks()['c']!.seq).toBeGreaterThan(seqOfA)
  })

  it('clear пуст — состояние не меняется', () => {
    const before = usePresence.getState()
    usePresence.getState().clear()
    expect(usePresence.getState()).toBe(before)
  })
})

describe('marksOnPage', () => {
  it('только эта страница, по одной метке на человека: та, где он двигался последним', () => {
    const marks = {
      a: stored({ client: 'a', user_id: 'u1', seq: 1 }),
      b: stored({ client: 'b', user_id: 'u1', seq: 4, start: 7, end: 8 }), // тот же человек с другого компьютера, позже
      c: stored({ client: 'c', user_id: 'u2', seq: 2 }),
      d: stored({ client: 'd', user_id: 'u3', seq: 3, id: 'другая' }),
      e: stored({ client: 'e', user_id: 'u4', seq: 5, kind: 'doc' }), // документ с тем же id — другое место
    }
    expect(marksOnPage(marks, 'wiki', 'w1').map((m) => [m.user_id, m.client])).toEqual([
      ['u2', 'c'],
      ['u1', 'b'],
    ])
  })
})

describe('placeMark: где блок метки у меня сейчас', () => {
  const base = doc('Первый', 'Второй', 'Третий') // строки: 0, пустая, 2, пустая, 4
  const textAt = (rev: number) => (rev === 1 ? base : undefined)

  it('у меня тот же текст: как в метке', () => {
    expect(placeMark({ rev: 1, start: 2, end: 3 }, base, textAt)).toEqual({ start: 2, end: 3 })
  })

  it('абзац добавлен выше: блок сдвинулся вниз', () => {
    expect(placeMark({ rev: 1, start: 4, end: 5 }, doc('Новый', 'Первый', 'Второй', 'Третий'), textAt)).toEqual({ start: 6, end: 7 })
  })

  it('мои правки внутри блока растягивают его', () => {
    expect(placeMark({ rev: 1, start: 2, end: 3 }, doc('Первый', 'Второй\nещё строка', 'Третий'), textAt)).toEqual({ start: 2, end: 4 })
  })

  it('блок у меня удалён: места нет', () => {
    expect(placeMark({ rev: 1, start: 2, end: 3 }, doc('Первый', 'Третий'), textAt)).toBeNull()
  })

  it('версии нет в запасе (слишком старая или ещё не дошла): номера как есть', () => {
    expect(placeMark({ rev: 9, start: 2, end: 3 }, base, textAt)).toEqual({ start: 2, end: 3 })
    expect(placeMark({ rev: 0, start: 4, end: 5 }, doc('А', 'Б', 'В', 'Г'), textAt)).toEqual({ start: 4, end: 5 })
  })

  it('за пределами моего текста места нет, а конец обрезается', () => {
    expect(placeMark({ rev: 9, start: 20, end: 21 }, base, textAt)).toBeNull()
    expect(placeMark({ rev: 9, start: 3, end: 40 }, base, textAt)).toEqual({ start: 3, end: 5 })
  })

  it('пустой блок между абзацами переезжает вместе с остальным', () => {
    const saved = 'А\n\n\n\nБ'
    expect(placeMark({ rev: 5, start: 2, end: 3 }, `Новый\n\n${saved}`, (r) => (r === 5 ? saved : undefined))).toEqual({ start: 4, end: 5 })
  })
})

describe('placeMarks', () => {
  const people = new Map([['u1', { name: 'Лена Крылова', tone: 3 }]])
  const same = () => undefined

  it('имя до первого пробела, цвет человека, строки у меня', () => {
    expect(placeMarks([stored({ user_id: 'u1', start: 2, end: 3 })], people, doc('А', 'Б'), same)).toEqual([
      { key: 'u1', name: 'Лена', tone: 3, start: 2, end: 3 },
    ])
  })

  it('человека нет в списке: «Участник» и цвет по умолчанию', () => {
    expect(placeMarks([stored({ user_id: 'u9' })], people, 'А', same)).toEqual([{ key: 'u9', name: 'Участник', tone: 0, start: 0, end: 1 }])
  })

  it('метка без места пропускается', () => {
    expect(placeMarks([stored({ start: 50, end: 51 })], people, 'А', same)).toEqual([])
  })

  it('firstName', () => {
    expect(firstName('  Лена   Крылова ')).toBe('Лена')
    expect(firstName('Одиночка')).toBe('Одиночка')
  })
})

describe('assignMarks: метки по блокам', () => {
  // А, пустая, Б, пустая, В (блоки на строках 0, 2, 4)
  const blocks = [
    { start: 0, end: 1 },
    { start: 2, end: 3 },
    { start: 4, end: 5 },
  ]
  const m = (key: string, start: number, end: number) => ({ key, name: key, tone: 0, start, end })

  it('метка попадает в блок, чьи строки она задевает; в какой именно из двух, решают первые строки', () => {
    const { inBlock, inGap } = assignMarks([m('a', 2, 3), m('b', 1, 4), m('c', 4, 5)], blocks)
    expect(inBlock.map((l) => l.map((x) => x.key))).toEqual([[], ['a', 'b'], ['c']])
    expect(inGap.flat()).toEqual([])
  })

  it('несколько людей в одном блоке идут в порядке прихода', () => {
    const { inBlock } = assignMarks([m('первый', 0, 1), m('второй', 0, 1)], blocks)
    expect(inBlock[0]!.map((x) => x.key)).toEqual(['первый', 'второй'])
  })

  it('пустые строки между блоками: метка стоит в промежутке перед следующим блоком', () => {
    const { inBlock, inGap } = assignMarks([m('x', 3, 4)], blocks)
    expect(inBlock.flat()).toEqual([])
    expect(inGap.map((l) => l.length)).toEqual([0, 0, 1, 0])
  })

  it('пустые строки после всех блоков: промежуток в конце', () => {
    const { inGap } = assignMarks([m('x', 6, 7)], blocks)
    expect(inGap.map((l) => l.length)).toEqual([0, 0, 0, 1])
  })

  it('в тексте нет блоков: единственный промежуток', () => {
    expect(assignMarks([m('x', 0, 1)], []).inGap.map((l) => l.length)).toEqual([1])
  })
})

describe('PresenceAnnouncer', () => {
  const at = (o: Partial<Position> = {}): Position => ({ kind: 'wiki', id: 'w1', rev: 1, start: 2, end: 3, ...o })
  let now: number
  let active: boolean
  let online: boolean
  let sent: unknown[]
  let a: PresenceAnnouncer

  const focus = (p: Position) => ({ type: 'focus', ...p })

  beforeEach(() => {
    vi.useFakeTimers()
    now = 1_000_000
    active = true
    online = true
    sent = []
    a = new PresenceAnnouncer({ now: () => now, active: () => active })
    a.attach((m) => {
      if (!online) return false
      sent.push(m)
      return true
    })
  })
  afterEach(() => {
    a.detach()
    vi.useRealTimers()
  })

  /** Время идёт и у таймеров, и у часов объявителя */
  const wait = (ms: number) => {
    now += ms
    vi.advanceTimersByTime(ms)
  }

  it('место сообщается после небольшой паузы, одно и то же — один раз', () => {
    a.set(at())
    expect(sent).toEqual([])
    wait(SEND_DELAY_MS)
    expect(sent).toEqual([focus(at())])
    a.set(at())
    wait(SEND_DELAY_MS)
    expect(sent).toHaveLength(1)
  })

  it('пока человек двигается, уходит только последнее место', () => {
    a.set(at({ start: 0, end: 1 }))
    wait(100)
    a.set(at({ start: 2, end: 3 }))
    wait(100)
    a.set(at({ start: 4, end: 5 }))
    wait(SEND_DELAY_MS)
    expect(sent).toEqual([focus(at({ start: 4, end: 5 }))])
  })

  it('«ушёл» уходит, только если место сообщали', () => {
    a.set(null)
    wait(SEND_DELAY_MS)
    expect(sent).toEqual([])
    a.set(at())
    wait(SEND_DELAY_MS)
    a.set(null)
    wait(SEND_DELAY_MS)
    expect(sent).toEqual([focus(at()), { type: 'blur' }])
  })

  it('пока человек в блоке, место подтверждается каждые 15 секунд, после ухода подтверждения прекращаются', () => {
    a.set(at())
    wait(SEND_DELAY_MS)
    wait(KEEPALIVE_MS)
    wait(KEEPALIVE_MS)
    expect(sent.filter((m) => (m as { type: string }).type === 'focus')).toHaveLength(3)
    a.set(null)
    wait(SEND_DELAY_MS)
    const count = sent.length
    wait(KEEPALIVE_MS * 3)
    expect(sent).toHaveLength(count)
  })

  it('связи нет: сказать нечем, а когда сервер ответил «ready», место сообщается', () => {
    online = false
    a.set(at())
    wait(SEND_DELAY_MS)
    expect(sent).toEqual([])
    online = true
    a.ready()
    expect(sent).toEqual([focus(at())])
  })

  it('связь пропала и вернулась: сообщаем заново, сервер нас забыл', () => {
    a.set(at())
    wait(SEND_DELAY_MS)
    a.lost()
    a.ready()
    expect(sent).toEqual([focus(at()), focus(at())])
  })

  it('окно потеряло фокус: метка снимается, при возвращении ставится снова', () => {
    a.set(at())
    wait(SEND_DELAY_MS)
    active = false
    wait(KEEPALIVE_MS) // очередное подтверждение видит, что окно не в работе
    expect(sent[sent.length - 1]).toEqual({ type: 'blur' })
    active = true
    a.ready()
    expect(sent[sent.length - 1]).toEqual(focus(at()))
  })

  it('человек отошёл на 2 минуты: метка снимается, первое же нажатие возвращает её', () => {
    a.set(at())
    wait(SEND_DELAY_MS)
    wait(AFK_MS + KEEPALIVE_MS)
    expect(sent[sent.length - 1]).toEqual({ type: 'blur' })
    a.touch()
    expect(sent[sent.length - 1]).toEqual(focus(at()))
  })

  it('пока человек нажимает клавиши, он не «отошёл»', () => {
    a.set(at())
    wait(SEND_DELAY_MS)
    for (let i = 0; i < 20; i++) {
      wait(KEEPALIVE_MS)
      a.touch()
    }
    expect(sent.every((m) => (m as { type: string }).type === 'focus')).toBe(true)
  })

  it('настройка выключена: ничего не сообщается, а прежнее место снимается; включили — возвращается', () => {
    a.set(at())
    wait(SEND_DELAY_MS)
    a.setEnabled(false)
    expect(sent[sent.length - 1]).toEqual({ type: 'blur' })
    a.set(at({ start: 7, end: 8 }))
    wait(SEND_DELAY_MS)
    expect(sent).toHaveLength(2)
    a.setEnabled(true)
    expect(sent[sent.length - 1]).toEqual(focus(at({ start: 7, end: 8 })))
  })

  it('после detach ничего не уходит и таймеры не работают', () => {
    a.set(at())
    wait(SEND_DELAY_MS)
    a.detach()
    wait(KEEPALIVE_MS * 3)
    expect(sent).toHaveLength(1)
  })
})
