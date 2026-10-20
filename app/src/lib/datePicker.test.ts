import { describe, expect, it } from 'vitest'
import { addMonths, isIsoDate, moveCursor, pickerDays } from './datePicker'

describe('календарик в поле даты', () => {
  it('isIsoDate: только настоящие даты', () => {
    expect(isIsoDate('2026-10-18')).toBe(true)
    expect(isIsoDate('2024-02-29')).toBe(true)
    for (const bad of ['', '2026-02-30', '2026-13-01', '18.10.2026', '2026-1-5', '0001-01-01']) expect(isIsoDate(bad)).toBe(false)
  })

  it('pickerDays: всегда 42 дня, неделя с понедельника', () => {
    // 1 октября 2026 — четверг: в первой строке три дня сентября
    const days = pickerDays(2026, 9, 'mon')
    expect(days).toHaveLength(42)
    expect(days[0]).toEqual({ date: '2026-09-28', num: 28, inMonth: false })
    expect(days[3]).toEqual({ date: '2026-10-01', num: 1, inMonth: true })
    expect(days.filter((d) => d.inMonth)).toHaveLength(31)
    expect(days[41]!.date).toBe('2026-11-08')
  })

  it('pickerDays: неделя с воскресенья', () => {
    const days = pickerDays(2026, 9, 'sun')
    expect(days[0]).toEqual({ date: '2026-09-27', num: 27, inMonth: false })
    expect(days[4]!.date).toBe('2026-10-01')
  })

  it('pickerDays: месяц, который начинается с первого дня недели, не прячется за хвостом прошлого', () => {
    // 1 июня 2026 — понедельник
    const days = pickerDays(2026, 5, 'mon')
    expect(days[0]).toEqual({ date: '2026-06-01', num: 1, inMonth: true })
  })

  it('addMonths обрезает день по длине месяца и переходит через год', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15')
    expect(addMonths('2026-10-18', 12)).toBe('2027-10-18')
  })

  it('moveCursor: стрелки, страницы, Home и End', () => {
    const d = '2026-10-18' // воскресенье
    expect(moveCursor(d, 'ArrowLeft', 'mon')).toBe('2026-10-17')
    expect(moveCursor(d, 'ArrowRight', 'mon')).toBe('2026-10-19')
    expect(moveCursor(d, 'ArrowUp', 'mon')).toBe('2026-10-11')
    expect(moveCursor(d, 'ArrowDown', 'mon')).toBe('2026-10-25')
    expect(moveCursor(d, 'PageUp', 'mon')).toBe('2026-09-18')
    expect(moveCursor(d, 'PageDown', 'mon')).toBe('2026-11-18')
    expect(moveCursor(d, 'PageDown', 'mon', true)).toBe('2027-10-18')
    expect(moveCursor(d, 'Home', 'mon')).toBe('2026-10-12')
    expect(moveCursor(d, 'End', 'mon')).toBe('2026-10-18')
    expect(moveCursor(d, 'Home', 'sun')).toBe('2026-10-18')
    expect(moveCursor(d, 'End', 'sun')).toBe('2026-10-24')
  })

  it('moveCursor: остальные клавиши не трогает', () => {
    for (const key of ['Enter', ' ', 'Tab', 'a', 'Escape']) expect(moveCursor('2026-10-18', key, 'mon')).toBeNull()
  })
})
