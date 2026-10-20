import { keys } from './api/queries'
import type { User } from './api/types'
import { queryClient } from './query'
import { useToast } from './toast'

/** Мои правки склеились с чужими: спокойное сообщение с именем автора чужой версии, если оно известно */
export function notifyMerged(updatedBy: string | null | undefined): void {
  const author = queryClient.getQueryData<User[]>(keys.users)?.find((u) => u.id === updatedBy)?.name
  useToast.getState().show(author ? `Объединено с правками: ${author}` : 'Объединено с чужими правками', 'info')
}
