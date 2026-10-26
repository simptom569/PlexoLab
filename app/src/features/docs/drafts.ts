// Черновики документов в памяти: у каждого открытого документа один для названия и текста (`PageDraft`, как у страниц
// вики) и один для холста (`CanvasDraft`). Живут, пока открыто окно: если уйти из документа, не дождавшись сохранения,
// оно всё равно закончится, а вернувшись, человек увидит свои правки, а не старые.

import { useEffect, useSyncExternalStore } from 'react'
import { api } from '../../lib/api/client'
import { copyTitle } from '../../lib/copyTitle'
import { keys } from '../../lib/api/queries'
import type { Doc, DocSummary, SavedCanvas } from '../../lib/api/types'
import { queryClient } from '../../lib/query'
import { useSession } from '../../lib/session'
import { useToast } from '../../lib/toast'
import { trackUnsent, untrackUnsent } from '../../lib/unsent'
import { PageDraft, type DraftDeps } from '../wiki/draft'
import { COPY_TOAST_MS } from '../wiki/drafts'
import type { CanvasState } from './canvas'
import { CanvasDraft, type CanvasDraftDeps } from './canvasDraft'

export const SAVE_DOC_FAILED = 'Не удалось сохранить документ, попробуем ещё раз'
export const SAVE_CANVAS_FAILED = 'Не удалось сохранить холст, попробуем ещё раз'

/** Карточки списка (фрагмент, миниатюра, дата) изменились: перечитаются, когда список снова откроется */
const staleList = () => void queryClient.invalidateQueries({ queryKey: keys.docs })

/**
 * Версия названия и текста с сервера → кэш документа. Холст и режим не трогаются: ответ на правку текста мог быть
 * собран раньше, чем сохранился холст или сменился режим «Страница / Холст», и откатил бы их.
 */
export function cacheDocContent(doc: Doc): void {
  queryClient.setQueryData<Doc>(keys.doc(doc.id), (old) =>
    old ? { ...doc, mode: old.mode, canvas_rev: old.canvas_rev, note: old.note, objects: old.objects, links: old.links } : doc,
  )
  staleList()
}

/** Сохранённый холст → кэш документа (текст и название остаются как были) */
export function cacheCanvas(id: string, saved: SavedCanvas): void {
  queryClient.setQueryData<Doc>(keys.doc(id), (old) =>
    old && saved.canvas_rev >= old.canvas_rev
      ? { ...old, canvas_rev: saved.canvas_rev, note: saved.note, objects: saved.objects, links: saved.links }
      : old,
  )
  staleList()
}

/**
 * Правки не слились с чужими, а человек ушёл из документа: они сохраняются новым документом «Название (правки Имя, дд.мм чч:мм)»
 * в том же проекте и режиме, сразу после оригинала. Оригинал остаётся с чужой версией. Возвращает название копии.
 */
async function saveDocCopy(original: Doc, mine: { title: string; md: string }): Promise<string> {
  const title = copyTitle(mine.title, useSession.getState().user?.name ?? '', new Date())
  const created = await api.post<Doc>(`/projects/${original.project_id}/docs`, { title, md: mine.md, mode: original.mode })
  try {
    // новый документ встаёт первым; переставляем его перед тем, что шёл за оригиналом (или в конец, если оригинал последний)
    const list = await api.get<DocSummary[]>(`/projects/${original.project_id}/docs`)
    const at = list.find((d) => d.id === original.id)
    if (at) {
      const next = list.filter((d) => d.id !== created.id && d.position > at.position).sort((a, b) => a.position - b.position)[0]
      await api.patch(`/docs/${created.id}`, { before_id: next ? next.id : null })
    }
  } catch {
    // копия уже сохранена, а её место в списке не страшно: останется первой
  }
  staleList()
  return title
}

const docDeps: DraftDeps<Doc> = {
  patch: (id, body) => api.patch<Doc>(`/docs/${id}`, body),
  onSaved: cacheDocContent,
  onError: () => useToast.getState().show(SAVE_DOC_FAILED),
  saveCopy: saveDocCopy,
  onCopySaved: (title) => useToast.getState().show(`Правки не удалось объединить с чужими, они сохранены отдельным документом «${title}»`, COPY_TOAST_MS),
}

const canvasDeps: CanvasDraftDeps = {
  put: (id, canvas: CanvasState) => api.put<SavedCanvas>(`/docs/${id}/canvas`, canvas),
  onSaved: cacheCanvas,
  onError: () => useToast.getState().show(SAVE_CANVAS_FAILED),
}

const textDrafts = new Map<string, PageDraft<Doc>>()
const canvasDrafts = new Map<string, CanvasDraft>()

export function docDraftFor(doc: Doc): PageDraft<Doc> {
  let draft = textDrafts.get(doc.id)
  if (!draft) {
    draft = new PageDraft(doc, docDeps)
    textDrafts.set(doc.id, draft)
    trackUnsent(draft)
  }
  return draft
}

export function canvasDraftFor(doc: Doc): CanvasDraft {
  let draft = canvasDrafts.get(doc.id)
  if (!draft) {
    draft = new CanvasDraft(doc.id, doc, canvasDeps)
    canvasDrafts.set(doc.id, draft)
    trackUnsent(draft)
  }
  return draft
}

/** Документ удалён: его черновики больше не сохраняются */
export function dropDocDrafts(ids: Iterable<string>): void {
  for (const id of ids) {
    for (const draft of [textDrafts.get(id), canvasDrafts.get(id)]) {
      if (!draft) continue
      draft.dispose()
      untrackUnsent(draft)
    }
    textDrafts.delete(id)
    canvasDrafts.delete(id)
  }
}

// Вышли или сессия потеряна: чужие и свои черновики не должны перейти к следующему человеку
useSession.subscribe((state, prev) => {
  if (prev.phase === 'ready' && state.phase !== 'ready') dropDocDrafts([...textDrafts.keys(), ...canvasDrafts.keys()])
})

/** Черновик названия и текста открытого документа. Новая версия с сервера принимается, если своих правок нет. */
export function useDocDraft(doc: Doc) {
  const draft = docDraftFor(doc)
  const state = useSyncExternalStore(draft.subscribe, draft.getState)
  useEffect(() => draft.adopt(doc), [draft, doc])
  // редактор после слияния уже открыл нужный блок: подсказка больше не нужна
  useEffect(() => draft.clearRestore(), [draft, state.resetKey])
  // уходя из документа, всё несохранённое отправляется сразу
  useEffect(() => () => void draft.flush(), [draft])
  return { draft, state }
}

/** Черновик холста открытого документа */
export function useCanvasDraft(doc: Doc) {
  const draft = canvasDraftFor(doc)
  const state = useSyncExternalStore(draft.subscribe, draft.getState)
  useEffect(() => draft.adopt(doc), [draft, doc])
  useEffect(() => () => void draft.flush(), [draft])
  return { draft, state }
}
