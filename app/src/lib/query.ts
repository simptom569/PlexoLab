import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api/client'
import { useSession } from './session'

export const queryClient = new QueryClient({
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
