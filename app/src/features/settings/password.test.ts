import { describe, expect, it } from 'vitest'
import { checkPasswordForm } from './password'

describe('проверка формы смены пароля', () => {
  it('годная форма проходит', () => {
    expect(checkPasswordForm('старый-пароль', 'новый-пароль-1', 'новый-пароль-1')).toBeNull()
  })

  it('текущий пароль обязателен', () => {
    expect(checkPasswordForm('', 'новый-пароль-1', 'новый-пароль-1')).toBe('Введите текущий пароль')
  })

  it('новый пароль не короче 8 символов; считаются символы, а не байты', () => {
    expect(checkPasswordForm('x', '1234567', '1234567')).toBe('Новый пароль короче 8 символов')
    expect(checkPasswordForm('x', '12345678', '12345678')).toBeNull()
    expect(checkPasswordForm('x', 'пароль7', 'пароль7')).toBe('Новый пароль короче 8 символов')
    expect(checkPasswordForm('x', 'пароль-8', 'пароль-8')).toBeNull()
  })

  it('повтор должен совпасть', () => {
    expect(checkPasswordForm('старый-пароль', 'новый-пароль-1', 'новый-пароль-2')).toBe('Пароли не совпадают')
  })

  it('новый пароль не может быть таким же, как текущий', () => {
    expect(checkPasswordForm('один-и-тот-же', 'один-и-тот-же', 'один-и-тот-же')).toBe('Новый пароль совпадает с текущим')
  })

  it('первая найденная ошибка важнее остальных', () => {
    expect(checkPasswordForm('', 'короткий', 'другой')).toBe('Введите текущий пароль')
    expect(checkPasswordForm('x', 'коротко', 'другой')).toBe('Новый пароль короче 8 символов')
  })
})
