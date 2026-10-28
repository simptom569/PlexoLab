import { describe, expect, it } from 'vitest'
import { isValidKey, normalizeKey, roleOf, visibilityChangeDetail, visibilityChangeText } from './project-dialogs'
import { visibilityOf } from './team-dialogs'

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

describe('смена видимости проекта', () => {
  it('заголовок окна подтверждения считает людей по-русски', () => {
    expect(visibilityChangeText('team', 1)).toBe('Проект увидят 1 член команды')
    expect(visibilityChangeText('team', 3)).toBe('Проект увидят 3 члена команды')
    expect(visibilityChangeText('team', 5)).toBe('Проект увидят 5 членов команды')
    expect(visibilityChangeText('team', 21)).toBe('Проект увидят 21 член команды')
    expect(visibilityChangeText('members', 1)).toBe('Доступ потеряют 1 человек')
    expect(visibilityChangeText('members', 2)).toBe('Доступ потеряют 2 человека')
    expect(visibilityChangeText('members', 7)).toBe('Доступ потеряют 7 человек')
  })

  it('пояснение: открытие не меняет доступ приглашённых и администраторов, закрытие оставляет им проект', () => {
    expect(visibilityChangeDetail('team')).toContain('Все члены команды')
    expect(visibilityChangeDetail('members')).toContain('Администраторы команды и приглашённые')
  })

  it('неизвестная видимость считается самой закрытой', () => {
    expect(visibilityOf('team')).toBe('team')
    expect(visibilityOf('members')).toBe('members')
    expect(visibilityOf('everyone')).toBe('members')
  })
})
