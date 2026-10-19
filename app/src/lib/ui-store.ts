import { create } from 'zustand'
import type { PageId } from './pages'
import { DEFAULT_SETTINGS, EMPTY_FILTERS, saveSettings, type Display, type DisplayKey, type DueFilter, type Filters, type Settings, type View } from './settings'

export type Theme = Settings['theme']

type Persisted = Pick<Settings, 'theme' | 'page' | 'project' | 'view' | 'filters' | 'display'>
const PERSISTED_KEYS: Array<keyof Persisted> = ['theme', 'page', 'project', 'view', 'filters', 'display']

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

  setPage: (page: PageId) => void
  setProject: (project: string) => void
  setView: (view: View) => void
  toggleTheme: () => void
  toggleMenu: (menu: string) => void
  closeMenus: () => void
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
}

export const useUi = create<UiState>()((set) => ({
  theme: DEFAULT_SETTINGS.theme,
  page: DEFAULT_SETTINGS.page,
  project: DEFAULT_SETTINGS.project,
  view: DEFAULT_SETTINGS.view,
  filters: DEFAULT_SETTINGS.filters,
  display: DEFAULT_SETTINGS.display,
  menu: null,
  q: '',
  openTaskId: null,
  confirmDelete: false,
  focusTitle: false,
  confirm: null,

  setPage: (page) => set({ page, menu: null, openTaskId: null, confirmDelete: false, confirm: null }),
  setProject: (project) => set({ project, menu: null, openTaskId: null, confirmDelete: false, confirm: null }),
  setView: (view) => set({ view, menu: null }),
  toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark', menu: null })),
  toggleMenu: (menu) => set((s) => ({ menu: s.menu === menu ? null : menu })),
  closeMenus: () => set({ menu: null }),
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
}))

/** Подставляет сохранённые настройки при запуске */
export function hydrateUi(settings: Settings): void {
  useUi.setState({ theme: settings.theme, page: settings.page, project: settings.project, view: settings.view, filters: settings.filters, display: settings.display })
}

// Изменения сохранённых полей уходят на диск
useUi.subscribe((state, prev) => {
  const changed: Partial<Persisted> = {}
  for (const key of PERSISTED_KEYS) if (state[key] !== prev[key]) Object.assign(changed, { [key]: state[key] })
  if (Object.keys(changed).length) saveSettings(changed)
})
