import { create } from 'zustand'
import type { PageId } from './pages'
import type { ProjectDialog, ProjectMenu, ProjectTab } from './project-dialogs'
import type { TeamMenu, TeamTab } from './team-dialogs'
import type { SettingsTab } from './settings-tabs'
import {
  DEFAULT_DISPLAY,
  DEFAULT_SETTINGS,
  EMPTY_FILTERS,
  saveSettings,
  type Display,
  type DisplayKey,
  type DueFilter,
  type Filters,
  type ScrollbarMode,
  type Settings,
  type Theme,
  type View,
  type WeekStart,
} from './settings'
import { resolveDark } from './theme'

export type { Theme }

type Persisted = Pick<Settings, 'theme' | 'scrollbars' | 'weekStart' | 'live' | 'presence' | 'closeToTray' | 'page' | 'project' | 'team' | 'view' | 'filters' | 'display'>
const PERSISTED_KEYS: Array<keyof Persisted> = ['theme', 'scrollbars', 'weekStart', 'live', 'presence', 'closeToTray', 'page', 'project', 'team', 'view', 'filters', 'display']

// Локальное состояние интерфейса. Часть сохраняется на диск (см. PERSISTED_KEYS), остальное живёт, пока открыто окно.
type UiState = Persisted & {
  /** Открытое меню или поповер ('user', 'filters', 'display', 'col:<id>', ...), null — всё закрыто (S.menu в макете) */
  menu: string | null
  /** Поиск по названию и номеру */
  q: string
  /** Открытая в панели задача (openId в макете) и первое нажатие «Удалить» (confirmDel) */
  openTaskId: string | null
  confirmDelete: boolean
  /** Панель только что создала задачу: поставить курсор в название */
  focusTitle: boolean
  /** Что просит подтверждения удаления: 'mod:<id>', 'ms:<id>', 'rel:<id>' (confirm в макете). Одно на весь экран. */
  confirm: string | null
  /** Открытое окно настроек: выбранная категория, null — окно закрыто */
  settingsTab: SettingsTab | null
  /** Открытое окно проектов (новый проект, настройки проекта, приглашения, архив), null — закрыто */
  projectDialog: ProjectDialog | null
  /** Меню проекта по правой кнопке */
  projectMenu: ProjectMenu | null
  /** Меню команды по правой кнопке на блоке PlexoLab */
  teamMenu: TeamMenu | null

  setPage: (page: PageId) => void
  setProject: (project: string) => void
  /** Выбрать команду: открытый проект, задача и меню остаются в прошлой команде, поэтому сбрасываются */
  setTeam: (team: string) => void
  setView: (view: View) => void
  /** Быстрое переключение из меню пользователя: на противоположную той, что видна сейчас */
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
  setScrollbars: (mode: ScrollbarMode) => void
  setWeekStart: (start: WeekStart) => void
  setLive: (live: boolean) => void
  setPresence: (presence: boolean) => void
  setCloseToTray: (closeToTray: boolean) => void
  toggleMenu: (menu: string) => void
  closeMenus: () => void
  openSettings: (tab?: SettingsTab) => void
  closeSettings: () => void
  setSettingsTab: (tab: SettingsTab) => void
  openProjectDialog: (dialog: ProjectDialog) => void
  closeProjectDialog: () => void
  setProjectTab: (tab: ProjectTab) => void
  setTeamTab: (tab: TeamTab) => void
  openProjectMenu: (menu: ProjectMenu) => void
  closeProjectMenu: () => void
  openTeamMenu: (menu: TeamMenu) => void
  closeTeamMenu: () => void
  setQuery: (q: string) => void
  openTask: (id: string, options?: { focusTitle?: boolean }) => void
  closeTask: () => void
  setConfirmDelete: (value: boolean) => void
  setConfirm: (key: string | null) => void
  /** «Показать на доске» в модуле: фильтр по одному модулю и переход на доску (openBoard в макете) */
  showModuleOnBoard: (moduleId: string) => void
  /** Включить или выключить значение в группе фильтра (исполнитель, приоритет, метка, модуль) */
  toggleFilter: (field: 'who' | 'prio' | 'tag' | 'module', value: string) => void
  setDue: (due: DueFilter) => void
  setFilters: (filters: Filters) => void
  clearFilters: () => void
  toggleDisplay: (key: DisplayKey) => void
  /** Поиск, фильтры, вид задач и «Отображение» карточки: к значениям по умолчанию */
  resetView: () => void
}

export const useUi = create<UiState>()((set) => ({
  theme: DEFAULT_SETTINGS.theme,
  scrollbars: DEFAULT_SETTINGS.scrollbars,
  weekStart: DEFAULT_SETTINGS.weekStart,
  live: DEFAULT_SETTINGS.live,
  presence: DEFAULT_SETTINGS.presence,
  closeToTray: DEFAULT_SETTINGS.closeToTray,
  page: DEFAULT_SETTINGS.page,
  project: DEFAULT_SETTINGS.project,
  team: DEFAULT_SETTINGS.team,
  view: DEFAULT_SETTINGS.view,
  filters: DEFAULT_SETTINGS.filters,
  display: DEFAULT_SETTINGS.display,
  menu: null,
  q: '',
  openTaskId: null,
  confirmDelete: false,
  focusTitle: false,
  confirm: null,
  settingsTab: null,
  projectDialog: null,
  projectMenu: null,
  teamMenu: null,

  setPage: (page) => set({ page, menu: null, openTaskId: null, confirmDelete: false, confirm: null }),
  setProject: (project) => set({ project, menu: null, openTaskId: null, confirmDelete: false, confirm: null }),
  setTeam: (team) =>
    set({ team, project: null, menu: null, projectMenu: null, teamMenu: null, openTaskId: null, confirmDelete: false, confirm: null }),
  setView: (view) => set({ view, menu: null }),
  toggleTheme: () => set((s) => ({ theme: resolveDark(s.theme) ? 'light' : 'dark', menu: null })),
  setTheme: (theme) => set({ theme }),
  setScrollbars: (scrollbars) => set({ scrollbars }),
  setWeekStart: (weekStart) => set({ weekStart }),
  setLive: (live) => set({ live }),
  setPresence: (presence) => set({ presence }),
  setCloseToTray: (closeToTray) => set({ closeToTray }),
  toggleMenu: (menu) => set((s) => ({ menu: s.menu === menu ? null : menu })),
  closeMenus: () => set({ menu: null }),
  openSettings: (tab = 'account') => set({ settingsTab: tab, projectDialog: null, menu: null }),
  closeSettings: () => set({ settingsTab: null }),
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  openProjectDialog: (projectDialog) =>
    set({ projectDialog, settingsTab: null, projectMenu: null, teamMenu: null, menu: null, confirm: null }),
  closeProjectDialog: () => set({ projectDialog: null, confirm: null }),
  setProjectTab: (tab) =>
    set((s) => (s.projectDialog?.kind === 'settings' ? { projectDialog: { ...s.projectDialog, tab }, confirm: null } : {})),
  openProjectMenu: (projectMenu) => set({ projectMenu, menu: null }),
  setTeamTab: (tab) =>
    set((s) => (s.projectDialog?.kind === 'team-settings' ? { projectDialog: { ...s.projectDialog, tab }, confirm: null } : {})),
  closeProjectMenu: () => set({ projectMenu: null, confirm: null }),
  openTeamMenu: (teamMenu) => set({ teamMenu, menu: null, projectMenu: null }),
  closeTeamMenu: () => set({ teamMenu: null, confirm: null }),
  setQuery: (q) => set({ q }),
  openTask: (id, options) => set({ openTaskId: id, confirmDelete: false, focusTitle: !!options?.focusTitle }),
  closeTask: () => set({ openTaskId: null, confirmDelete: false, focusTitle: false }),
  setConfirmDelete: (confirmDelete) => set({ confirmDelete }),
  setConfirm: (confirm) => set({ confirm }),
  showModuleOnBoard: (moduleId) =>
    set({ page: 'board', view: 'board', filters: { ...EMPTY_FILTERS, module: [moduleId] }, q: '', menu: null, openTaskId: null, confirmDelete: false, confirm: null }),
  toggleFilter: (field, value) =>
    set((s) => {
      const list = s.filters[field] as string[]
      const next = list.includes(value) ? list.filter((x) => x !== value) : [...list, value]
      return { filters: { ...s.filters, [field]: next } as Filters }
    }),
  setDue: (due) => set((s) => ({ filters: { ...s.filters, due } })),
  setFilters: (filters) => set({ filters }),
  clearFilters: () => set({ filters: { who: [], prio: [], tag: [], module: [], due: 'any' }, q: '' }),
  toggleDisplay: (key) => set((s) => ({ display: { ...s.display, [key]: !s.display[key] } as Display })),
  resetView: () => set({ view: DEFAULT_SETTINGS.view, filters: EMPTY_FILTERS, display: DEFAULT_DISPLAY, q: '', menu: null }),
}))

/** Подставляет сохранённые настройки при запуске */
export function hydrateUi(settings: Settings): void {
  useUi.setState({
    theme: settings.theme,
    scrollbars: settings.scrollbars,
    weekStart: settings.weekStart,
    live: settings.live,
    presence: settings.presence,
    closeToTray: settings.closeToTray,
    page: settings.page,
    project: settings.project,
    team: settings.team,
    view: settings.view,
    filters: settings.filters,
    display: settings.display,
  })
}

// Изменения сохранённых полей уходят на диск
useUi.subscribe((state, prev) => {
  const changed: Partial<Persisted> = {}
  for (const key of PERSISTED_KEYS) if (state[key] !== prev[key]) Object.assign(changed, { [key]: state[key] })
  if (Object.keys(changed).length) saveSettings(changed)
})
