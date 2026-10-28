// Окна проектов (docs/PROJECTS.md, раздел 3): новый проект, настройки проекта, приглашения, архив проектов; рядом с ними
// окно «Уведомления» (docs/OFFLINE-NOTIFY-SEARCH.md, раздел 2).
// В макете их нет, они собраны из деталей окна «Настройки» (styles/projects.css).

import { plural } from './date'
import type { TeamTab, Visibility } from './team-dialogs'

export const PROJECT_TABS = ['main', 'members', 'tags', 'archive'] as const
export type ProjectTab = (typeof PROJECT_TABS)[number]

export const PROJECT_TAB_LABELS: Record<ProjectTab, string> = {
  main: 'Основное',
  members: 'Участники',
  tags: 'Метки',
  archive: 'Архив',
}

/** Какое окно проектов и команд открыто; в каждый момент не больше одного */
export type ProjectDialog =
  | { kind: 'new' }
  | { kind: 'new-team' }
  | { kind: 'team-settings'; id: string; tab: TeamTab }
  | { kind: 'team-members'; id: string }
  | { kind: 'all-teams' }
  | { kind: 'settings'; id: string; tab: ProjectTab }
  | { kind: 'invites' }
  | { kind: 'archive' }
  | { kind: 'notifications' }
  | { kind: 'search' }

/** Меню проекта по правой кнопке: где оно открыто на экране */
export type ProjectMenu = { id: string; x: number; y: number }

export const ROLE_LABELS = { admin: 'Администратор', member: 'Участник' } as const
export type ProjectRole = keyof typeof ROLE_LABELS

/** Роль из ответа сервера: неизвестное значение считаем самым слабым */
export const roleOf = (role: string): ProjectRole => (role === 'admin' ? 'admin' : 'member')

/** Цвета проекта (токены из styles.css), как их принимает сервер */
export const PROJECT_COLORS = [
  { value: 'accent', name: 'Синий' },
  { value: 'warn', name: 'Жёлтый' },
  { value: 'ok', name: 'Зелёный' },
] as const

/** Ключ id задач в том виде, в каком его примет сервер: без пробелов по краям, латиница в верхнем регистре */
export const normalizeKey = (raw: string): string => raw.trim().toUpperCase()

/** Что отвечаем, когда ключ не подошёл */
export const KEY_RULE = 'Ключ: от 2 до 6 символов, латиница и цифры, начинается с буквы'

/** Подходит ли ключ (пустой значит «без ключа»): 2–6 символов, латиница и цифры, с буквы */
export const isValidKey = (key: string): boolean => key === '' || /^[A-Z][A-Z0-9]{1,5}$/.test(key)

/** Заголовок окна подтверждения смены видимости (docs/TEAMS.md, 3.4): сколько человек это затронет */
export const visibilityChangeText = (to: Visibility, people: number): string =>
  to === 'team'
    ? `Проект увидят ${people} ${plural(people, 'член команды', 'члена команды', 'членов команды')}`
    : `Доступ потеряют ${people} ${plural(people, 'человек', 'человека', 'человек')}`

/** Пояснение к окну подтверждения смены видимости */
export const visibilityChangeDetail = (to: Visibility): string =>
  to === 'team'
    ? 'Все члены команды смогут открывать проект и работать в нём как участники. Приглашённым и администраторам команды это ничего не меняет.'
    : 'Этих людей нет в списке участников проекта. Администраторы команды и приглашённые в проект сохранят доступ.'

/** Пределы сервера (domain::projects) */
export const PROJECT_NAME_MAX = 60
