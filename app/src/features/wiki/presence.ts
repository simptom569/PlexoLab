// Присутствие на странице вики или в документе: чужие метки для редактора и сообщение о своём блоке. Один хук на оба
// раздела: у них один редактор и один `PageDraft`.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useUsers } from '../../lib/api/queries'
import { announcer, marksOnPage, placeMarks, usePresence, type PlacedMark, type Person } from '../../lib/realtime/presence'
import { useUi } from '../../lib/ui-store'
import type { DraftState, PageDraft, Versioned } from './draft'

/**
 * `marks` — где сейчас другие люди в этом тексте (уже пересчитанные под то, что показано у меня); `onActiveChange` —
 * сюда редактор сообщает, какой блок открыт у меня.
 *
 * Своё место сообщается только пока текст совпадает с сохранённым: номера строк тогда верны для версии `rev`, и чужой
 * клиент найдёт блок по тексту этой версии. Пока я печатаю, остаётся прежнее сообщение (блок тот же), а после сохранения
 * уходит новое. Баннер конфликта: ничего не сообщаем.
 */
export function usePagePresence<P extends Versioned>(kind: 'wiki' | 'doc', id: string, draft: PageDraft<P>, state: DraftState<P>) {
  const shown = useUi((s) => s.presence && s.live)
  const users = useUsers().data
  const all = usePresence((s) => s.marks)

  const people = useMemo(() => new Map<string, Person>((users ?? []).map((u) => [u.id, { name: u.name, tone: u.tone }])), [users])
  const marks = useMemo<PlacedMark[]>(
    () => (shown ? placeMarks(marksOnPage(all, kind, id), people, state.md, draft.textAt) : []),
    // новая версия сервера почти всегда меняет и `state.md`, так что запас версий (`draft.textAt`) отдельно не отслеживается
    [shown, all, kind, id, people, state.md, draft],
  )

  const [active, setActive] = useState<{ start: number; end: number } | null>(null)
  const onActiveChange = useCallback((block: { start: number; end: number } | null) => setActive(block), [])

  useEffect(() => {
    if (!active) {
      announcer.set(null)
      return
    }
    if (state.conflict || !state.mdClean) return
    announcer.set({ kind, id, rev: state.rev, start: active.start, end: active.end })
  }, [active, kind, id, state.rev, state.mdClean, state.conflict])

  // ушли со страницы: метка снимается
  useEffect(() => () => announcer.set(null), [])

  return { marks, onActiveChange }
}
