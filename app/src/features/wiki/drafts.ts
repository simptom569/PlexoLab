// Черновики страниц вики в памяти: по одному на страницу, пока открыто окно (см. draft.ts).

import { useEffect, useSyncExternalStore } from 'react'
import { api } from '../../lib/api/client'
import { keys } from '../../lib/api/queries'
import type { WikiNode, WikiPage } from '../../lib/api/types'
import { queryClient } from '../../lib/query'
import { useSession } from '../../lib/session'
import { useToast } from '../../lib/toast'
import { trackUnsent, untrackUnsent } from '../../lib/unsent'
import { PageDraft, type DraftDeps } from './draft'

export const SAVE_PAGE_FAILED = 'Не удалось сохранить страницу, попробуем ещё раз'

/** Страница без текста: так она лежит в дереве */
export const toNode = ({ md: _md, ...node }: WikiPage): WikiNode => node

/** Версия с сервера → кэш страницы и дерева */
export function cachePage(page: WikiPage): void {
  queryClient.setQueryData(keys.wikiPage(page.id), page)
  queryClient.setQueryData<WikiNode[]>(keys.wiki, (list) => list?.map((n) => (n.id === page.id ? toNode(page) : n)))
}

const deps: DraftDeps = {
  patch: (id, body) => api.patch<WikiPage>(`/wiki/${id}`, body),
  onSaved: cachePage,
  onError: () => useToast.getState().show(SAVE_PAGE_FAILED),
}

const drafts = new Map<string, PageDraft>()

/** Черновик страницы: создаётся по загруженной версии и дальше живёт сам */
export function draftFor(page: WikiPage): PageDraft {
  let draft = drafts.get(page.id)
  if (!draft) {
    draft = new PageDraft(page, deps)
    drafts.set(page.id, draft)
    trackUnsent(draft)
  }
  return draft
}

/** Страницы удалены: их черновики больше не сохраняются */
export function dropDrafts(ids: Iterable<string>): void {
  for (const id of ids) {
    const draft = drafts.get(id)
    if (draft) {
      draft.dispose()
      untrackUnsent(draft)
    }
    drafts.delete(id)
  }
}

// Вышли или сессия потеряна: чужие и свои черновики не должны перейти к следующему человеку
useSession.subscribe((state, prev) => {
  if (prev.phase === 'ready' && state.phase !== 'ready') dropDrafts([...drafts.keys()])
})

/**
 * Черновик открытой страницы. Новая версия с сервера принимается, если своих правок нет.
 * Уходя со страницы, всё несохранённое отправляется сразу.
 */
export function usePageDraft(page: WikiPage) {
  const draft = draftFor(page)
  const state = useSyncExternalStore(draft.subscribe, draft.getState)
  useEffect(() => draft.adopt(page), [draft, page])
  // редактор после слияния уже открыл нужный блок: подсказка больше не нужна, иначе вернувшись на страницу он открыл бы его снова
  useEffect(() => draft.clearRestore(), [draft, state.resetKey])
  useEffect(() => () => void draft.flush(), [draft])
  return { draft, state }
}
