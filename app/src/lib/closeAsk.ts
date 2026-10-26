// Вопрос при закрытии приложения с неотправленным текстом: «Есть неотправленные правки, закрыть?».
// Окно вопроса показывает features/workspace/CloseAskDialog, а защита при закрытии (lib/closeGuard.ts) ждёт ответа.

import { create } from 'zustand'

type CloseAskState = {
  open: boolean
  /** Показать вопрос; ответ `true` — закрыть всё равно, `false` — остаться */
  ask: () => Promise<boolean>
  /** Человек ответил (или закрыл окно вопроса: это «остаться») */
  answer: (closeAnyway: boolean) => void
}

let pending: ((closeAnyway: boolean) => void) | null = null

export const useCloseAsk = create<CloseAskState>()((set) => ({
  open: false,
  ask: () => {
    // второй вопрос подряд (повторное нажатие на крестик) получает тот же ответ, что и первый
    if (pending) {
      const first = pending
      return new Promise<boolean>((resolve) => {
        pending = (v) => {
          first(v)
          resolve(v)
        }
      })
    }
    return new Promise<boolean>((resolve) => {
      pending = resolve
      set({ open: true })
    })
  },
  answer: (closeAnyway) => {
    const resolve = pending
    pending = null
    set({ open: false })
    resolve?.(closeAnyway)
  },
}))
