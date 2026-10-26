// Прочитал одно уведомление или все: на экране сразу, на сервер уходит следом; отказ вернёт прежний вид.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api/client'
import { keys } from '../../lib/api/queries'
import type { NotificationList } from '../../lib/api/types'
import { markAllRead, markRead } from './logic'

type Snapshot = { before: NotificationList | undefined }

function useRead<V>(call: (v: V) => Promise<unknown>, change: (list: NotificationList, v: V) => NotificationList) {
  const qc = useQueryClient()
  return useMutation<unknown, Error, V, Snapshot>({
    mutationFn: call,
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: keys.notifications })
      const before = qc.getQueryData<NotificationList>(keys.notifications)
      qc.setQueryData<NotificationList>(keys.notifications, (list) => list && change(list, v))
      return { before }
    },
    onError: (_e, _v, ctx) => qc.setQueryData(keys.notifications, ctx?.before),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.notifications }),
  })
}

export const useReadNotification = () =>
  useRead<{ id: string }>(({ id }) => api.post(`/notifications/${id}/read`), (list, { id }) => markRead(list, id))

export const useReadAllNotifications = () => useRead<void>(() => api.post('/notifications/read-all'), (list) => markAllRead(list))
