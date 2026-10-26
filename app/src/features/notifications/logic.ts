// Уведомления: что показывать в строке и как список меняется, когда человек читает (docs/OFFLINE-NOTIFY-SEARCH.md, раздел 2).

import type { NotificationList } from '../../lib/api/types'

/** Что случилось. Безлично, без рода: имена и роды людей в приложении неизвестны. */
export const KIND_TEXT: Record<string, string> = {
  assigned: 'Вас назначили исполнителем',
  mentioned: 'Вас упомянули в комментарии',
}

export const kindText = (kind: string): string => KIND_TEXT[kind] ?? 'Новое уведомление'

/** Список после того, как человек прочитал одно уведомление. Неизвестное и уже прочитанное ничего не меняют. */
export function markRead(list: NotificationList, id: string): NotificationList {
  const item = list.items.find((n) => n.id === id)
  if (!item || item.read) return list
  return { items: list.items.map((n) => (n.id === id ? { ...n, read: true } : n)), unread: Math.max(0, list.unread - 1) }
}

/** Список после «Прочитать все» */
export function markAllRead(list: NotificationList): NotificationList {
  return { items: list.items.map((n) => (n.read ? n : { ...n, read: true })), unread: 0 }
}

/** Подпись счётчика над списком */
export const unreadText = (unread: number): string => (unread > 0 ? `Непрочитанных: ${unread}` : 'Всё прочитано')
