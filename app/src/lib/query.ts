import { MutationCache, QueryClient } from '@tanstack/react-query'
import { ApiError } from './api/client'
import { OfflineError, onLinkRestored, resetLink } from './link'
import { useSession } from './session'
import { SAVE_FAILED, useToast } from './toast'

export const queryClient = new QueryClient({
  // Любое изменение, в котором сервер отказал, уже откатилось на экране: сообщаем об этом плашкой.
  // Отказ из-за режима «только просмотр» объясняет себя сам (текст ошибки), остальное: «изменение отменено».
  mutationCache: new MutationCache({
    onError: (error) => useToast.getState().show(error instanceof OfflineError ? error.message : SAVE_FAILED),
  }),
  defaultOptions: {
    queries: {
      // Без связи запрос не «замирает» в ожидании сети, а сразу заканчивается ошибкой: о связи говорит lib/link.ts,
      // а экраны оставляют на месте то, что уже загружено
      networkMode: 'always',
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // ошибки вида «нельзя / не найдено / не прошла проверка» повтором не лечатся
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
    // то же для изменений: без связи они не ждут сети в очереди (сделанное пока связи не было, так не отправилось бы
    // само), а откатываются сразу
    mutations: { networkMode: 'always' },
  },
})

/**
 * Запрос не удался, а показывать нечего: данных нет совсем. Если данные есть (загрузили раньше, а обновить не вышло,
 * например нет связи), экран остаётся как есть, ошибку показывать не надо.
 */
export const failed = (q: { isError: boolean; data: unknown }): boolean => q.isError && q.data === undefined

// Связь вернулась: пока её не было, другие могли что-то изменить
onLinkRestored(() => void queryClient.invalidateQueries())

// Вышли или сессия потеряна: данные прошлого пользователя убираем из памяти
useSession.subscribe((state, prev) => {
  if (prev.phase === 'ready' && state.phase !== 'ready') {
    queryClient.clear()
    resetLink()
  }
})
