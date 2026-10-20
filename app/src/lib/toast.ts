import { create } from 'zustand'

/** Сообщение, когда сервер отказал в изменении и экран вернулся к прежнему виду */
export const SAVE_FAILED = 'Не удалось сохранить, изменение отменено'

/** Сообщение, когда файлы не загрузились (слишком большой файл, нет связи) */
export const UPLOAD_FAILED = 'Не удалось загрузить файлы'

/** Время показа плашки, мс */
export const TOAST_MS = 4000

/** error — красная плашка (не удалось); info — спокойная (сообщение о том, что произошло) */
export type ToastTone = 'error' | 'info'

type ToastState = {
  message: string | null
  tone: ToastTone
  /** Растёт с каждым показом: повторное сообщение перезапускает таймер */
  seq: number
  show: (message: string, tone?: ToastTone) => void
  hide: () => void
}

export const useToast = create<ToastState>()((set) => ({
  message: null,
  tone: 'error',
  seq: 0,
  show: (message, tone = 'error') => set((s) => ({ message, tone, seq: s.seq + 1 })),
  hide: () => set({ message: null }),
}))
