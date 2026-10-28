// Черновики страниц вики в памяти: по одному на страницу, пока открыто окно (см. draft.ts).

import { useEffect, useSyncExternalStore } from 'react'
import { api } from '../../lib/api/client'
import { copyTitle } from '../../lib/copyTitle'
import { keys } from '../../lib/api/queries'
import type { WikiNode, WikiPage } from '../../lib/api/types'
import { queryClient } from '../../lib/query'
import { teamPath } from '../../lib/team'
import { useSession } from '../../lib/session'
import { useToast } from '../../lib/toast'
import { trackUnsent, untrackUnsent } from '../../lib/unsent'
import { PageDraft, type DraftDeps } from './draft'

export const SAVE_PAGE_FAILED = 'Не удалось сохранить страницу, попробуем ещё раз'

/** Сообщение о копии длиннее обычной плашки: человеку надо успеть прочитать, где его правки */
export const COPY_TOAST_MS = 9000

/** Страница без текста: так она лежит в дереве */
export const toNode = ({ md: _md, ...node }: WikiPage): WikiNode => node

/** Версия с сервера → кэш страницы и дерева */
export function cachePage(page: WikiPage): void {
  queryClient.setQueryData(keys.wikiPage(page.id), page)
  queryClient.setQueryData<WikiNode[]>(keys.wiki, (list) => list?.map((n) => (n.id === page.id ? toNode(page) : n)))
}

/**
 * Правки не слились с чужими, а человек ушёл со страницы: они сохраняются новой страницей «Название (правки Имя, дд.мм чч:мм)»
 * у того же родителя, сразу после оригинала. Оригинал остаётся с чужой версией. Возвращает название копии.
 */
async function saveCopy(original: WikiPage, mine: { title: string; md: string }): Promise<string> {
  const title = copyTitle(mine.title, useSession.getState().user?.name ?? '', new Date())
  const parent = original.parent_id ?? null
  const created = await api.post<WikiPage>(teamPath('/wiki'), { title, md: mine.md, parent_id: parent })
  try {
    // сервер кладёт новую страницу в конец; переставляем её перед той, что шла за оригиналом
    const siblings = await api.get<WikiNode[]>(teamPath('/wiki'))
    const next = siblings
      .filter((n) => n.id !== created.id && (n.parent_id ?? null) === parent && n.position > original.position)
      .sort((a, b) => a.position - b.position)[0]
    if (next) await api.patch(`/wiki/${created.id}`, { before_id: next.id })
  } catch {
    // копия уже сохранена, а её место среди соседей не страшно: останется в конце
  }
  void queryClient.invalidateQueries({ queryKey: keys.wiki })
  return title
}

const deps: DraftDeps = {
  patch: (id, body) => api.patch<WikiPage>(`/wiki/${id}`, body),
  onSaved: cachePage,
  onError: () => useToast.getState().show(SAVE_PAGE_FAILED),
  saveCopy,
  onCopySaved: (title) => useToast.getState().show(`Правки не удалось объединить с чужими, они сохранены отдельной страницей «${title}»`, COPY_TOAST_MS),
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
