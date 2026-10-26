import { create } from 'zustand'

/** Сообщение, когда сервер отказал в изменении и экран вернулся к прежнему виду */
export const SAVE_FAILED = 'Не удалось сохранить, изменение отменено'

/** Сообщение, когда файлы не загрузились (слишком большой файл, нет связи) */
export const UPLOAD_FAILED = 'Не удалось загрузить файлы'

/** Время показа плашки, мс */
export const TOAST_MS = 4000

type ToastState = {
  message: string | null
  /** Сколько показывать это сообщение, мс */
  ms: number
  /** Растёт с каждым показом: повторное сообщение перезапускает таймер */
  seq: number
  show: (message: string, ms?: number) => void
  hide: () => void
}

export const useToast = create<ToastState>()((set) => ({
  message: null,
  ms: TOAST_MS,
  seq: 0,
  show: (message, ms = TOAST_MS) => set((s) => ({ message, ms, seq: s.seq + 1 })),
  hide: () => set({ message: null }),
}))
