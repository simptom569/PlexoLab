// Окна и меню команд (docs/TEAMS.md, раздел 11). Окна лежат в том же месте, что окна проектов (`ProjectDialog`): в каждый
// момент открыто не больше одного.

export const TEAM_TABS = ['main', 'members', 'archive'] as const
export type TeamTab = (typeof TEAM_TABS)[number]

export const TEAM_TAB_LABELS: Record<TeamTab, string> = {
  main: 'Основное',
  members: 'Участники',
  archive: 'Архив',
}

/** Меню команды по правой кнопке на блоке PlexoLab: где оно открыто на экране */
export type TeamMenu = { x: number; y: number }

/** Пределы сервера (domain::teams) */
export const TEAM_NAME_MAX = 60

/** Видимость проекта (docs/TEAMS.md, 3.4) */
export const VISIBILITY_LABELS = { members: 'Только участники', team: 'Вся команда' } as const
export type Visibility = keyof typeof VISIBILITY_LABELS

/** Видимость из ответа сервера: неизвестное значение считаем самым закрытым */
export const visibilityOf = (value: string): Visibility => (value === 'team' ? 'team' : 'members')
