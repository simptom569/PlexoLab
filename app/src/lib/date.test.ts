import { describe, expect, it } from 'vitest'
import { addDays, dayHeading, dayOf, fd, iso, mondayOf, plural, todayIso, toMs, whenText } from './date'

describe('даты', () => {
  it('toMs и iso взаимно обратны', () => {
    for (const d of ['2026-10-18', '2026-01-01', '2024-02-29', '2026-12-31']) expect(iso(toMs(d))).toBe(d)
  })

  it('addDays переходит через месяц, год и високосный день', () => {
    expect(addDays('2026-10-18', 7)).toBe('2026-10-25')
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('fd: «19 окт», пустое для отсутствующей даты', () => {
    expect(fd('2026-10-19')).toBe('19 окт')
    expect(fd('2026-05-01')).toBe('1 мая')
    expect(fd(null)).toBe('')
    expect(fd(undefined)).toBe('')
  })

  it('todayIso берёт локальную дату, а не UTC', () => {
    expect(todayIso(new Date(2026, 9, 18, 0, 5))).toBe('2026-10-18')
    expect(todayIso(new Date(2026, 9, 18, 23, 55))).toBe('2026-10-18')
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('mondayOf: неделя начинается с понедельника', () => {
    expect(mondayOf('2026-10-18')).toBe('2026-10-12') // воскресенье «сегодня» макета
    expect(mondayOf('2026-10-12')).toBe('2026-10-12') // сам понедельник
    expect(mondayOf('2026-10-14')).toBe('2026-10-12')
    expect(mondayOf('2026-10-19')).toBe('2026-10-19')
    expect(mondayOf('2027-01-01')).toBe('2026-12-28') // через границу года
  })
})

describe('plural', () => {
  const task = (n: number) => `${n} ${plural(n, 'задача', 'задачи', 'задач')}`
  it('склоняет как в макете', () => {
    expect([1, 2, 3, 4, 5, 11, 12, 14, 15, 21, 22, 25, 100, 101, 111, 112].map(task)).toEqual([
      '1 задача', '2 задачи', '3 задачи', '4 задачи', '5 задач', '11 задач', '12 задач', '14 задач', '15 задач',
      '21 задача', '22 задачи', '25 задач', '100 задач', '101 задача', '111 задач', '112 задач',
    ])
    expect(task(0)).toBe('0 задач')
  })
})

describe('whenText', () => {
  const now = new Date(2026, 9, 18, 15, 0)
  const at = (d: Date) => whenText(d.toISOString(), now)
  it('сегодня: относительное время', () => {
    expect(at(new Date(2026, 9, 18, 15, 0, 20))).toBe('только что')
    expect(at(new Date(2026, 9, 18, 14, 59))).toBe('1 минуту назад')
    expect(at(new Date(2026, 9, 18, 14, 48))).toBe('12 минут назад')
    expect(at(new Date(2026, 9, 18, 14, 0))).toBe('1 час назад')
    expect(at(new Date(2026, 9, 18, 12, 0))).toBe('3 часа назад')
    expect(at(new Date(2026, 9, 18, 0, 5))).toBe('14 часов назад')
  })
  it('вчера и раньше: день и время', () => {
    expect(at(new Date(2026, 9, 17, 17, 40))).toBe('вчера, 17:40')
    expect(at(new Date(2026, 9, 17, 23, 59))).toBe('вчера, 23:59')
    expect(at(new Date(2026, 9, 12, 9, 5))).toBe('12 окт, 09:05')
  })
})

describe('dayOf и dayHeading', () => {
  const now = new Date(2026, 9, 18, 15, 0)

  it('dayOf берёт день по местным часам, а не по UTC', () => {
    expect(dayOf(new Date(2026, 9, 18, 0, 5).toISOString())).toBe('2026-10-18')
    expect(dayOf(new Date(2026, 9, 18, 23, 55).toISOString())).toBe('2026-10-18')
  })

  it('заголовок: Сегодня, Вчера, день и месяц', () => {
    expect(dayHeading('2026-10-18', now)).toBe('Сегодня')
    expect(dayHeading('2026-10-17', now)).toBe('Вчера')
    expect(dayHeading('2026-10-15', now)).toBe('15 октября')
    expect(dayHeading('2026-01-01', now)).toBe('1 января')
    expect(dayHeading('2026-05-09', now)).toBe('9 мая')
  })

  it('вчера считается и через границу месяца и года', () => {
    expect(dayHeading('2026-09-30', new Date(2026, 9, 1, 9, 0))).toBe('Вчера')
    expect(dayHeading('2025-12-31', new Date(2026, 0, 1, 9, 0))).toBe('Вчера')
  })

  it('из другого года добавляется год', () => {
    expect(dayHeading('2025-12-30', now)).toBe('30 декабря 2025')
  })
})
