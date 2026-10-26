import { useEffect } from 'react'
import { linkLost, probeLinkNow } from './link'

/**
 * Следит за сетью, пока открыто рабочее пространство: система сказала «сети нет» — связи нет сразу, не дожидаясь
 * неудачного запроса; сеть вернулась или окно снова на виду — проверяем связь сейчас, а не через паузу (lib/link.ts).
 */
export function useLinkWatch(): void {
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') probeLinkNow()
    }
    window.addEventListener('offline', linkLost)
    window.addEventListener('online', probeLinkNow)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('offline', linkLost)
      window.removeEventListener('online', probeLinkNow)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
}
