export const PAGE_IDS = ['board', 'backlog', 'modules', 'releases', 'wiki', 'docs', 'activity', 'links'] as const
export type PageId = (typeof PAGE_IDS)[number]

// Названия экранов (PAGES в макете)
export const PAGE_LABELS: Record<PageId, string> = {
  board: 'Доска',
  backlog: 'Бэклог',
  modules: 'Модули',
  releases: 'Релизы и вехи',
  wiki: 'Вики',
  docs: 'Документы',
  activity: 'Активность',
  links: 'Ссылки команды',
}
