import { MutationCache, QueryClient } from '@tanstack/react-query'
import { ApiError } from './api/client'
import { useSession } from './session'
import { SAVE_FAILED, useToast } from './toast'

export const queryClient = new QueryClient({
  // Любое изменение, в котором сервер отказал, уже откатилось на экране: сообщаем об этом плашкой
  mutationCache: new MutationCache({ onError: () => useToast.getState().show(SAVE_FAILED) }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // ошибки вида «нельзя / не найдено / не прошла проверка» повтором не лечатся
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
})

// Вышли или сессия потеряна: данные прошлого пользователя убираем из памяти
useSession.subscribe((state, prev) => {
  if (prev.phase === 'ready' && state.phase !== 'ready') queryClient.clear()
})
