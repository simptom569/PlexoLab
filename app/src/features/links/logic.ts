// Ссылки команды без React: адрес и правки списка групп для оптимистичных обновлений. Порт vLinks макета.

import type { LinkGroup, LinkItem } from '../../lib/api/types'

/**
 * Адрес для хранения: пробелы по краям убраны, без схемы добавляется `https://` (addLink в макете).
 * `null`, если адрес пустой. Сервер делает то же самое и остаётся главным.
 */
export function normalizeUrl(raw: string): string | null {
  const url = raw.trim()
  if (!url) return null
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

/** Адрес без схемы для карточки: `example.com/git/api` (host в макете) */
export const hostOf = (url: string): string => url.replace(/^https?:\/\//i, '')

export const addGroup = (list: LinkGroup[], group: LinkGroup): LinkGroup[] => [...list.filter((g) => g.id !== group.id), group]

export const renameGroup = (list: LinkGroup[], id: string, title: string): LinkGroup[] =>
  list.map((g) => (g.id === id ? { ...g, title } : g))

export const removeGroup = (list: LinkGroup[], id: string): LinkGroup[] => list.filter((g) => g.id !== id)

/** Ссылка в конец своей группы; если такая уже есть (пришла другим путём), она заменяется, а не дублируется */
export const addLink = (list: LinkGroup[], link: LinkItem): LinkGroup[] =>
  list.map((g) => (g.id === link.group_id ? { ...g, links: [...g.links.filter((l) => l.id !== link.id), link] } : g))

export const removeLink = (list: LinkGroup[], id: string): LinkGroup[] =>
  list.map((g) => (g.links.some((l) => l.id === id) ? { ...g, links: g.links.filter((l) => l.id !== id) } : g))
