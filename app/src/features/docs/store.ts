// Локальное состояние экрана «Документы»: открытый документ, поиск и фильтр «Избранные».
// Живёт, пока открыто окно; на диск сохраняются открытый документ и фильтр.

import { create } from 'zustand'
import { saveSettings, type Settings } from '../../lib/settings'

type DocsState = {
  /** Открытый документ (docId в макете); null — виден список */
  docId: string | null
  /** Поиск по названию и тексту */
  q: string
  /** Фильтр «Избранные» */
  starOnly: boolean
  /** Документ только что создан человеком: открыть его сразу на первом блоке */
  editNew: string | null

  openDoc: (id: string) => void
  closeDoc: () => void
  setQuery: (q: string) => void
  toggleStarOnly: () => void
  /** Документ создан: открыть его, сбросить поиск (createDoc в макете) */
  created: (id: string) => void
  /** Начатое «с первого блока» редактирование принято редактором */
  editStarted: () => void
}

export const useDocsStore = create<DocsState>()((set) => ({
  docId: null,
  q: '',
  starOnly: false,
  editNew: null,

  openDoc: (docId) => set({ docId, editNew: null }),
  closeDoc: () => set({ docId: null, editNew: null }),
  setQuery: (q) => set({ q }),
  toggleStarOnly: () => set((s) => ({ starOnly: !s.starOnly })),
  created: (id) => set({ docId: id, q: '', editNew: id }),
  editStarted: () => set({ editNew: null }),
}))

/** Подставляет сохранённое при запуске */
export function hydrateDocs(settings: Settings): void {
  useDocsStore.setState({ docId: settings.docOpen, starOnly: settings.docStar })
}

useDocsStore.subscribe((state, prev) => {
  if (state.docId !== prev.docId) saveSettings({ docOpen: state.docId })
  if (state.starOnly !== prev.starOnly) saveSettings({ docStar: state.starOnly })
})
