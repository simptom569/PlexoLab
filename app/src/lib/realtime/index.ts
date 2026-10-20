// Живые обновления: после входа клиент держит соединение с сервером и перечитывает то, что поменяли другие.
// События от наших собственных запросов пропускаются (`X-Client-Id`): свои изменения экран уже показал сам.

import type { QueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import { isBusy } from '../busy'
import { useSession } from '../session'
import { CLIENT_ID } from './clientId'
import { RealtimeConnection, socketUrl, type ConnectionStatus } from './connection'
import { queryKeysFor } from './events'
import { Invalidator } from './invalidator'

/** Состояние связи для точки в боковом меню */
export const useConnection = create<{ status: ConnectionStatus }>()(() => ({ status: 'offline' }))

/** Запустить живые обновления; возвращает функцию остановки (выход из приложения) */
export function startRealtime(client: QueryClient): () => void {
  // «все запросы» — это пустой ключ
  const everything: [[]] = [[]]
  const invalidator = new Invalidator(client, () => client.isMutating() > 0 || isBusy())

  const connection = new RealtimeConnection({
    url: () => socketUrl(useSession.getState().serverUrl),
    token: () => useSession.getState().accessToken,
    refreshToken: () => useSession.getState().refreshAccessToken(),
    onStatus: (status) => useConnection.setState({ status }),
    onMessage: (message) => {
      if (message.kind === 'resync') invalidator.add(everything) // отстали, часть событий потеряна
      else if (message.kind === 'event' && message.event.origin !== CLIENT_ID) invalidator.add(queryKeysFor(message.event))
    },
    // связь теряли: пока её не было, другие могли что-то изменить
    onReady: (catchUp) => {
      if (catchUp) invalidator.add(everything)
    },
  })
  connection.start()

  return () => {
    connection.stop()
    invalidator.clear()
  }
}
