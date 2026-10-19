import { create } from 'zustand'
import type { PageId } from './pages'
import { DEFAULT_SETTINGS, saveSettings, type Display, type DisplayKey, type DueFilter, type Filters, type Settings, type View } from './settings'

export type Theme = Settings['theme']

type Persisted = Pick<Settings, 'theme' | 'page' | 'project' | 'view' | 'filters' | 'display'>
const PERSISTED_KEYS: Array<keyof Persisted> = ['theme', 'page', 'project', 'view', 'filters', 'display']

// Локальное состояние интерфейса. Часть сохраняется на диск (см. PERSISTED_KEYS), остальное живёт, пока открыто окно.
type UiState = Persisted & {
  /** Открытое меню или поповер ('user', 'filters', 'display', 'col:<id>', ...), null — всё закрыто (S.menu в макете) */
  menu: string | null
  /** Поиск по названию и номеру */
  q: string

  setPage: (page: PageId) => void
  setProject: (project: string) => void
  setView: (view: View) => void
  toggleTheme: () => void
  toggleMenu: (menu: string) => void
  closeMenus: () => void
  setQuery: (q: string) => void
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

  setPage: (page) => set({ page, menu: null }),
  setProject: (project) => set({ project, menu: null }),
  setView: (view) => set({ view, menu: null }),
  toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark', menu: null })),
  toggleMenu: (menu) => set((s) => ({ menu: s.menu === menu ? null : menu })),
  closeMenus: () => set({ menu: null }),
  setQuery: (q) => set({ q }),
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
