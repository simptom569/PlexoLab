// Живые обновления: после входа клиент держит соединение с сервером и перечитывает то, что поменяли другие.
// События от наших собственных запросов пропускаются (`X-Client-Id`): свои изменения экран уже показал сам.

import type { QueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import { isBusy } from '../busy'
import { linkLost, linkRestored } from '../link'
import { useSession } from '../session'
import { useUi } from '../ui-store'
import { CLIENT_ID } from './clientId'
import { RealtimeConnection, socketUrl, type ConnectionStatus } from './connection'
import { queryKeysFor, type Message } from './events'
import { Invalidator } from './invalidator'
import { announcer, usePresence } from './presence'

/** Состояние связи для точки в боковом меню */
export const useConnection = create<{ status: ConnectionStatus }>()(() => ({ status: 'offline' }))

/** Запустить живые обновления; возвращает функцию остановки (выход из приложения) */
export function startRealtime(client: QueryClient): () => void {
  // «все запросы» — это пустой ключ
  const everything: [[]] = [[]]
  const invalidator = new Invalidator(client, () => client.isMutating() > 0 || isBusy())
  // после остановки соединение само сообщает «связи нет»: это не потеря связи с сервером
  let stopped = false

  const connection = new RealtimeConnection({
    url: () => socketUrl(useSession.getState().serverUrl),
    token: () => useSession.getState().accessToken,
    refreshToken: () => useSession.getState().refreshAccessToken(),
    onStatus: (status) => {
      useConnection.setState({ status })
      // живое соединение — тоже свидетель: открылось, значит, сервер на связи; закрылось, значит, проверим (lib/link.ts)
      if (status === 'open') linkRestored()
      else if (status === 'offline' && !stopped) linkLost()
      // связи нет: сервер уже снял нашу метку, а чужие могли поменяться без нас; новый список придёт после «ready»
      if (status !== 'open') {
        usePresence.getState().clear()
        announcer.lost()
      }
    },
    onMessage: (message) => {
      if (handlePresence(message)) return
      if (message.kind === 'resync') invalidator.add(everything) // отстали, часть событий потеряна
      else if (message.kind === 'event' && message.event.origin !== CLIENT_ID) invalidator.add(queryKeysFor(message.event))
    },
    onReady: (catchUp) => {
      announcer.ready() // сервер о нас ничего не знает: если человек в блоке, скажем заново
      // связь теряли: пока её не было, другие могли что-то изменить
      if (catchUp) invalidator.add(everything)
    },
  })
  // свой блок сообщается через это же соединение; настройка выключена — не сообщаем и чужих не показываем
  announcer.attach((message) => connection.send(message))
  announcer.setEnabled(useUi.getState().presence)
  const stopWatchingSetting = useUi.subscribe((state, prev) => {
    if (state.presence !== prev.presence) announcer.setEnabled(state.presence)
  })
  connection.start()

  return () => {
    stopped = true
    stopWatchingSetting()
    announcer.detach()
    connection.stop()
    usePresence.getState().clear()
    invalidator.clear()
  }
}

/** Сообщения о том, кто в каком блоке: в хранилище меток. `true`, если сообщение было такое. */
function handlePresence(message: Message): boolean {
  const presence = usePresence.getState()
  switch (message.kind) {
    case 'presence':
      presence.replaceAll(message.marks)
      return true
    case 'presence.set':
      presence.set(message.mark)
      return true
    case 'presence.gone':
      presence.gone(message.client)
      return true
    default:
      return false
  }
}
