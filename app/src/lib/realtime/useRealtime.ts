import type { QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { ConnectionStatus } from './connection'
import { startRealtime, useConnection } from './index'

/**
 * Держит связь с сервером, пока компонент на экране (Workspace показан только после входа), и возвращает её состояние
 * для точки в боковом меню.
 *
 * Запуск отложен на такт: React при разработке монтирует компонент дважды подряд, и без этого сервер видел бы два
 * подключения, из которых первое тут же закрывается. Пока запуска нет, состояние «подключаюсь», а не «нет связи»,
 * иначе при каждом входе точка мигала бы красным.
 *
 * `enabled: false` (настройка «Обновлять вживую» выключена): связи нет совсем, данные обновляются только при открытии экранов.
 */
export function useRealtime(client: QueryClient, enabled = true): ConnectionStatus {
  useEffect(() => {
    if (!enabled) {
      useConnection.setState({ status: 'offline' })
      return
    }
    useConnection.setState({ status: 'connecting' })
    let stop: (() => void) | undefined
    const timer = setTimeout(() => {
      stop = startRealtime(client)
    })
    return () => {
      clearTimeout(timer)
      stop?.()
    }
  }, [client, enabled])
  return useConnection((s) => s.status)
}
