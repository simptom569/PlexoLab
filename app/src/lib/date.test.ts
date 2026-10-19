import { describe, expect, it } from 'vitest'
import { addDays, fd, iso, mondayOf, plural, todayIso, toMs } from './date'

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
