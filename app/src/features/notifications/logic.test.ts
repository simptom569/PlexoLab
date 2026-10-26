import { describe, expect, it } from 'vitest'
import type { Notification, NotificationList } from '../../lib/api/types'
import { kindText, markAllRead, markRead, unreadText } from './logic'

const n = (id: string, read = false): Notification => ({
  id,
  kind: 'assigned',
  actor_id: null,
  project_id: 'p',
  task_id: 't',
  task_key: 'WEB-1',
  task_title: 'Задача',
  comment: null,
  read,
  created_at: '2026-10-18T12:00:00Z',
})

const list = (): NotificationList => ({ items: [n('a'), n('b', true), n('c')], unread: 2 })

describe('markRead', () => {
  it('отмечает одно и уменьшает счётчик', () => {
    const next = markRead(list(), 'a')
    expect(next.items.map((i) => i.read)).toEqual([true, true, false])
    expect(next.unread).toBe(1)
  })

  it('уже прочитанное и неизвестное не меняют список', () => {
    const l = list()
    expect(markRead(l, 'b')).toBe(l)
    expect(markRead(l, 'нет такого')).toBe(l)
  })

  it('счётчик не уходит ниже нуля', () => {
    expect(markRead({ items: [n('a')], unread: 0 }, 'a').unread).toBe(0)
  })

  it('исходный список не меняется', () => {
    const l = list()
    markRead(l, 'a')
    expect(l.items[0]!.read).toBe(false)
    expect(l.unread).toBe(2)
  })
})

describe('markAllRead', () => {
  it('всё прочитано, счётчик ноль', () => {
    const next = markAllRead(list())
    expect(next.items.every((i) => i.read)).toBe(true)
    expect(next.unread).toBe(0)
  })

  it('прочитанные остаются теми же объектами', () => {
    const l = list()
    expect(markAllRead(l).items[1]).toBe(l.items[1])
  })
})

describe('тексты', () => {
  it('что случилось, безлично', () => {
    expect(kindText('assigned')).toBe('Вас назначили исполнителем')
    expect(kindText('mentioned')).toBe('Вас упомянули в комментарии')
    expect(kindText('что-то новое')).toBe('Новое уведомление')
  })

  it('подпись счётчика', () => {
    expect(unreadText(3)).toBe('Непрочитанных: 3')
    expect(unreadText(0)).toBe('Всё прочитано')
  })
})
