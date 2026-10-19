import { create } from 'zustand'
import type { PageId } from './pages'

export type Theme = 'light' | 'dark'

// Локальное состояние интерфейса. Сохранение в tauri-plugin-store появится на этапе 3.
type UiState = {
  page: PageId
  project: string
  theme: Theme
  /** Открытое меню или поповер ('user', 'filters', ...), null — всё закрыто (S.menu в макете) */
  menu: string | null
  setPage: (page: PageId) => void
  setProject: (project: string) => void
  toggleTheme: () => void
  toggleMenu: (menu: string) => void
  closeMenus: () => void
}

export const useUi = create<UiState>()((set) => ({
  page: 'board',
  project: 'web',
  theme: 'light',
  menu: null,
  setPage: (page) => set({ page, menu: null }),
  setProject: (project) => set({ project, menu: null }),
  toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark', menu: null })),
  toggleMenu: (menu) => set((s) => ({ menu: s.menu === menu ? null : menu })),
  closeMenus: () => set({ menu: null }),
}))
