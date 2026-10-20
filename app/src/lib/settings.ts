// Настройки конкретного человека на конкретном компьютере: тема, вид доски, фильтры, «Отображение», открытая страница,
// адрес сервера. На сервер они не отправляются (CLAUDE.md). Хранятся через lib/platform/storage.ts.

import { z } from 'zod'
import { PAGE_IDS } from './pages'
import { readSettings, writeSettings } from './platform/storage'

export const VIEWS = ['board', 'list', 'table', 'cal', 'gantt'] as const
export type View = (typeof VIEWS)[number]

export const DUE_FILTERS = ['any', 'overdue', 'week', 'none'] as const
export type DueFilter = (typeof DUE_FILTERS)[number]

/** Что показывать на карточке (dispDefs в макете) */
export const DISPLAY_KEYS = ['who', 'due', 'tags', 'prio', 'subs', 'pr', 'module'] as const
export type DisplayKey = (typeof DISPLAY_KEYS)[number]

/** Фильтр «Тип события» в ленте: категории сервера (GET /activity?kind=) и «все» */
export const ACT_KINDS = ['all', 'tasks', 'comment', 'code', 'doc', 'release', 'file', 'module'] as const
export type ActKind = (typeof ACT_KINDS)[number]

export const filtersSchema = z.object({
  /** Идентификаторы исполнителей; '-' означает «без исполнителя» */
  who: z.array(z.string()).catch([]),
  prio: z.array(z.enum(['high', 'med', 'low'])).catch([]),
  tag: z.array(z.string()).catch([]),
  /** Идентификаторы модулей; '-' означает «без модуля» */
  module: z.array(z.string()).catch([]),
  due: z.enum(DUE_FILTERS).catch('any'),
})
export type Filters = z.infer<typeof filtersSchema>

export const EMPTY_FILTERS: Filters = { who: [], prio: [], tag: [], module: [], due: 'any' }

const displaySchema = z.object(
  Object.fromEntries(DISPLAY_KEYS.map((k) => [k, z.boolean().catch(true)])) as Record<DisplayKey, z.ZodCatch<z.ZodBoolean>>,
)
export type Display = z.infer<typeof displaySchema>

export const DEFAULT_DISPLAY: Display = { who: true, due: true, tags: true, prio: true, subs: true, pr: true, module: true }

export const settingsSchema = z.object({
  serverUrl: z.string().nullable().catch(null),
  lastEmail: z.string().catch(''),
  theme: z.enum(['light', 'dark']).catch('light'),
  page: z.enum(PAGE_IDS).catch('board'),
  project: z.string().nullable().catch(null),
  view: z.enum(VIEWS).catch('board'),
  filters: filtersSchema.catch(EMPTY_FILTERS),
  display: displaySchema.catch(DEFAULT_DISPLAY),
  /** Последняя открытая страница вики */
  wikiPage: z.string().nullable().catch(null),
  /** Открытый документ; null — виден список */
  docOpen: z.string().nullable().catch(null),
  /** В списке документов включён фильтр «Избранные» */
  docStar: z.boolean().catch(false),
  /** Фильтры ленты активности: участник ('all' или его идентификатор) и тип события */
  actWho: z.string().catch('all'),
  actKind: z.enum(ACT_KINDS).catch('all'),
})
export type Settings = z.infer<typeof settingsSchema>

/** Разбирает то, что лежит на диске: что не подошло, заменяется значением по умолчанию, остальное сохраняется */
export function parseSettings(raw: unknown): Settings {
  const isObject = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
  return settingsSchema.parse(isObject ? raw : {})
}

export const DEFAULT_SETTINGS: Settings = parseSettings({})

let current: Settings = DEFAULT_SETTINGS
let timer: ReturnType<typeof setTimeout> | undefined

/** Читает настройки при запуске. Дальше `getSettings` отдаёт их из памяти. */
export async function loadSettings(): Promise<Settings> {
  current = parseSettings(await readSettings())
  return current
}

export const getSettings = (): Settings => current

/**
 * Обновляет часть настроек и сохраняет их с небольшой задержкой (быстрые изменения пишутся одним разом).
 * `immediate`: записать сразу, для того, что нельзя потерять (адрес сервера, e-mail).
 */
export function saveSettings(patch: Partial<Settings>, options: { immediate?: boolean } = {}): void {
  current = { ...current, ...patch }
  clearTimeout(timer)
  if (options.immediate) void writeSettings(current)
  else timer = setTimeout(() => void writeSettings(current), 300)
}

// Окно закрывают сразу после изменения: не теряем то, что ещё ждёт записи
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    clearTimeout(timer)
    void writeSettings(current)
  })
}

/** Для тестов: записать сразу */
export async function flushSettings(): Promise<void> {
  clearTimeout(timer)
  await writeSettings(current)
}
