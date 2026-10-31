import { useEffect } from 'react'
import { isTauri } from '../../lib/platform/runtime'
import { CHECK_EVERY_MS, FIRST_CHECK_DELAY_MS } from './logic'
import { useUpdates } from './store'

/**
 * Фоновая проверка обновлений: через пару секунд после запуска и дальше раз в несколько часов, пока приложение работает.
 * Нашлась новая версия — у имени пользователя загорается точка, в меню появляется пункт (components/Sidebar.tsx).
 * Ошибки молчат: нет связи сегодня, проверим в следующий раз. В браузере (разработка, тесты) ничего не делает.
 */
export function useUpdateCheck(): void {
  useEffect(() => {
    if (!isTauri()) return
    const check = () => void useUpdates.getState().check({ silent: true })
    const first = setTimeout(check, FIRST_CHECK_DELAY_MS)
    const repeat = setInterval(check, CHECK_EVERY_MS)
    return () => {
      clearTimeout(first)
      clearInterval(repeat)
    }
  }, [])
}
