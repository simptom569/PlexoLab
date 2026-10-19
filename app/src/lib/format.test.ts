import { describe, expect, it } from 'vitest'
import { formatSize } from './format'

describe('formatSize', () => {
  it('килобайты, не меньше 1 КБ', () => {
    expect(formatSize(0)).toBe('1 КБ')
    expect(formatSize(300)).toBe('1 КБ')
    expect(formatSize(12 * 1024)).toBe('12 КБ')
    expect(formatSize(1_048_576)).toBe('1024 КБ')
  })
  it('мегабайты с одним знаком, начиная с чуть больше 1 МБ', () => {
    expect(formatSize(1_048_577)).toBe('1.0 МБ')
    expect(formatSize(1_468_006)).toBe('1.4 МБ')
    expect(formatSize(25 * 1_048_576)).toBe('25.0 МБ')
  })
})
