import { describe, expect, it } from 'vitest'
import { milestoneWhen, percent, tasksText } from './progress'

describe('percent', () => {
  it('округляет, без задач — ноль', () => {
    expect(percent(1, 3)).toBe(33)
    expect(percent(2, 3)).toBe(67)
    expect(percent(3, 3)).toBe(100)
    expect(percent(0, 0)).toBe(0)
  })
})

describe('tasksText', () => {
  it('склоняет «задачи» как в макете: после «из» — родительный падеж', () => {
    expect(tasksText(0, 1)).toBe('0 из 1 задачи')
    expect(tasksText(0, 2)).toBe('0 из 2 задач')
    expect(tasksText(1, 3)).toBe('1 из 3 задач')
    expect(tasksText(2, 5)).toBe('2 из 5 задач')
    expect(tasksText(0, 0)).toBe('0 из 0 задач')
    expect(tasksText(1, 21)).toBe('1 из 21 задачи')
  })
})

describe('milestoneWhen', () => {
  const today = '2026-10-18'

  it('впереди: «через N дн.»; сегодня: «сегодня»', () => {
    expect(milestoneWhen('2026-10-23', today, 33)).toEqual({ text: 'через 5 дн.', late: false })
    expect(milestoneWhen('2026-10-18', today, 0)).toEqual({ text: 'сегодня', late: false })
  })

  it('позади и не готова: просрочена, красным', () => {
    expect(milestoneWhen('2026-10-15', today, 50)).toEqual({ text: 'просрочена на 3 дн.', late: true })
    expect(milestoneWhen('2026-10-17', today, 0)).toEqual({ text: 'просрочена на 1 дн.', late: true })
  })

  it('позади, но все задачи готовы: «прошла», не красным', () => {
    expect(milestoneWhen('2026-10-15', today, 100)).toEqual({ text: 'прошла', late: false })
  })

  it('через границу месяца и года', () => {
    expect(milestoneWhen('2027-01-02', '2026-12-30', 0).text).toBe('через 3 дн.')
  })
})
