import { create } from 'zustand'

/** Сообщение, когда сервер отказал в изменении и экран вернулся к прежнему виду */
export const SAVE_FAILED = 'Не удалось сохранить, изменение отменено'

/** Время показа плашки, мс */
export const TOAST_MS = 4000

type ToastState = {
  message: string | null
  /** Растёт с каждым показом: повторное сообщение перезапускает таймер */
  seq: number
  show: (message: string) => void
  hide: () => void
}

export const useToast = create<ToastState>()((set) => ({
  message: null,
  seq: 0,
  show: (message) => set((s) => ({ message, seq: s.seq + 1 })),
  hide: () => set({ message: null }),
}))
