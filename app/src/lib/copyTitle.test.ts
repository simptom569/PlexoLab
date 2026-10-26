import { describe, expect, it } from 'vitest'
import { copyTitle, MAX_TITLE_LEN, stamp } from './copyTitle'

const at = new Date(2026, 9, 25, 14, 5) // 25 октября 2026, 14:05 по часам машины

describe('stamp', () => {
  it('день.месяц часы:минуты с ведущими нулями', () => {
    expect(stamp(at)).toBe('25.10 14:05')
    expect(stamp(new Date(2026, 0, 3, 9, 7))).toBe('03.01 09:07')
  })
})

describe('copyTitle', () => {
  it('прежнее название, затем кто и когда', () => {
    expect(copyTitle('План релиза', 'Лена М.', at)).toBe('План релиза (правки Лена М., 25.10 14:05)')
  })

  it('у страницы без названия: «Без названия»', () => {
    expect(copyTitle('', 'Лена М.', at)).toBe('Без названия (правки Лена М., 25.10 14:05)')
    expect(copyTitle('   ', 'Лена М.', at)).toBe('Без названия (правки Лена М., 25.10 14:05)')
  })

  it('пробелы по краям названия и имени не попадают в результат', () => {
    expect(copyTitle('  План  ', '  Артём К. ', at)).toBe('План (правки Артём К., 25.10 14:05)')
  })

  it('без имени подставляется «без имени»', () => {
    expect(copyTitle('План', '', at)).toBe('План (правки без имени, 25.10 14:05)')
  })

  it('длинное название обрезается с многоточием и укладывается в лимит сервера', () => {
    const title = copyTitle('я'.repeat(300), 'Лена М.', at)
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LEN)
    expect(title).toContain('…')
    expect(title.endsWith('(правки Лена М., 25.10 14:05)')).toBe(true)
  })

  it('название ровно по лимиту с суффиксом не обрезается лишний раз', () => {
    const suffix = ' (правки Лена М., 25.10 14:05)'
    const base = 'я'.repeat(MAX_TITLE_LEN - suffix.length)
    expect(copyTitle(base, 'Лена М.', at)).toBe(base + suffix)
  })
})
