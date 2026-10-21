import { describe, expect, it } from 'vitest'
import { isValidKey, normalizeKey, roleOf } from './project-dialogs'

describe('ключ id задач', () => {
  it('приводится к верхнему регистру без пробелов по краям', () => {
    expect(normalizeKey('  plx ')).toBe('PLX')
    expect(normalizeKey('Seo2')).toBe('SEO2')
    expect(normalizeKey('   ')).toBe('')
  })

  it('пустой ключ значит «без ключа», остальные 2–6 символов латиницы и цифр с буквы', () => {
    for (const ok of ['', 'AB', 'ABCDEF', 'A1', 'PLX9']) expect(isValidKey(ok), ok).toBe(true)
    for (const bad of ['A', 'ABCDEFG', '1AB', 'A-B', 'A B', 'ПЛЕКС', 'plx']) expect(isValidKey(bad), bad).toBe(false)
  })
})

describe('роль', () => {
  it('неизвестная роль считается участником', () => {
    expect(roleOf('admin')).toBe('admin')
    expect(roleOf('member')).toBe('member')
    expect(roleOf('owner')).toBe('member')
    expect(roleOf('')).toBe('member')
  })
})
