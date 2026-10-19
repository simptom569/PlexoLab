// Чистые преобразования списка релизов для оптимистичных обновлений: экран меняется сразу, сервер подтверждает позже.

import type { Release, ReleaseItem, UpdateRelease, UpdateReleaseItem } from '../../lib/api/types'

/** Релизы от новых к старым (при равных датах порядок не меняется) */
export const byDateDesc = (list: Release[]): Release[] =>
  list.slice().sort((a, b) => (a.release_date < b.release_date ? 1 : a.release_date > b.release_date ? -1 : 0))

export function patchRelease(list: Release[], id: string, patch: UpdateRelease): Release[] {
  const next = list.map((r) =>
    r.id !== id
      ? r
      : {
          ...r,
          version: patch.version ?? r.version,
          release_date: patch.release_date ?? r.release_date,
          status: patch.status ?? r.status,
          notes: patch.notes ?? r.notes,
        },
  )
  return byDateDesc(next)
}

export const removeRelease = (list: Release[], id: string): Release[] => list.filter((r) => r.id !== id)

const mapItems = (list: Release[], releaseId: string, fn: (items: ReleaseItem[]) => ReleaseItem[]): Release[] =>
  list.map((r) => (r.id === releaseId ? { ...r, items: fn(r.items) } : r))

export const addItem = (list: Release[], releaseId: string, item: ReleaseItem): Release[] =>
  mapItems(list, releaseId, (items) => [...items.filter((i) => i.id !== item.id), item])

export const patchItem = (list: Release[], releaseId: string, id: string, patch: UpdateReleaseItem): Release[] =>
  mapItems(list, releaseId, (items) =>
    items.map((i) => (i.id === id ? { ...i, title: patch.title ?? i.title, done: patch.done ?? i.done } : i)),
  )

export const removeItem = (list: Release[], releaseId: string, id: string): Release[] =>
  mapItems(list, releaseId, (items) => items.filter((i) => i.id !== id))

/** «4 из 7» и процент выполнения чек-листа */
export function checklistProgress(release: Release): { done: number; total: number; pct: number } {
  const total = release.items.length
  const done = release.items.filter((i) => i.done).length
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 }
}
