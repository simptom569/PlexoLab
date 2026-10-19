// Локальное состояние экрана «Вики»: открытая страница, раскрытые ветки дерева, поиск, папка и фильтры библиотеки.
// Живёт, пока открыто окно; на диск сохраняется только последняя открытая страница.

import { create } from 'zustand'
import { saveSettings, type Settings } from '../../lib/settings'
import type { FileKind } from './logic'

export type WikiView = 'page' | 'files'

type WikiState = {
  /** Открытая страница (wikiId в макете); null — ещё не выбрана, откроется первая */
  pageId: string | null
  view: WikiView
  /** Поиск по страницам */
  q: string
  /** Раскрытые страницы дерева */
  open: Record<string, boolean>
  /** Библиотека: открытая папка (null — корень), тип, поиск, название новой папки */
  folder: string | null
  kind: 'all' | FileKind
  fileQ: string
  newFolder: string
  /** Страница только что создана человеком: открыть её сразу на первом блоке */
  editNew: string | null

  openPage: (id: string) => void
  showFiles: () => void
  setQuery: (q: string) => void
  toggleOpen: (id: string) => void
  /** Раскрыть страницы (родителей открытой страницы), не сворачивая уже раскрытые */
  reveal: (ids: string[]) => void
  /** Страница создана: открыть её, раскрыть родителя, сбросить поиск */
  created: (id: string, parentId: string | null) => void
  /** Начатое «с первого блока» редактирование принято редактором */
  editStarted: () => void
  setFolder: (folder: string | null) => void
  setKind: (kind: 'all' | FileKind) => void
  setFileQuery: (q: string) => void
  setNewFolder: (name: string) => void
  /** «Все файлы»: корень без поиска и фильтра */
  libraryRoot: () => void
}

export const useWikiStore = create<WikiState>()((set) => ({
  pageId: null,
  view: 'page',
  q: '',
  open: {},
  folder: null,
  kind: 'all',
  fileQ: '',
  newFolder: '',
  editNew: null,

  openPage: (id) => set({ pageId: id, view: 'page', editNew: null }),
  showFiles: () => set({ view: 'files', editNew: null }),
  setQuery: (q) => set({ q }),
  toggleOpen: (id) => set((s) => ({ open: { ...s.open, [id]: !s.open[id] } })),
  reveal: (ids) => set((s) => ({ open: { ...s.open, ...Object.fromEntries(ids.map((id) => [id, true])) } })),
  created: (id, parentId) =>
    set((s) => ({ pageId: id, view: 'page', q: '', editNew: id, open: parentId ? { ...s.open, [parentId]: true } : s.open })),
  editStarted: () => set({ editNew: null }),
  setFolder: (folder) => set({ folder }),
  setKind: (kind) => set({ kind }),
  setFileQuery: (fileQ) => set({ fileQ }),
  setNewFolder: (newFolder) => set({ newFolder }),
  libraryRoot: () => set({ folder: null, kind: 'all', fileQ: '' }),
}))

/** Подставляет сохранённую страницу при запуске */
export function hydrateWiki(settings: Settings): void {
  useWikiStore.setState({ pageId: settings.wikiPage })
}

useWikiStore.subscribe((state, prev) => {
  if (state.pageId !== prev.pageId) saveSettings({ wikiPage: state.pageId })
})
