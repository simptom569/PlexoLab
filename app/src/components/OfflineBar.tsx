import { useEffect, useState } from 'react'
import { useReadOnly } from '../lib/link'
import { unsentCount } from '../lib/unsent'

/**
 * Полоска сверху рабочей области, пока нет связи с сервером и править нельзя (lib/link.ts). В макете такого элемента
 * нет, собрана из его переменных, как баннер конфликта.
 */
export function OfflineBar() {
  const readOnly = useReadOnly()
  const unsent = useUnsent(readOnly)
  if (!readOnly) return null
  return (
    <div
      role="status"
      aria-live="polite"
      data-offline-bar
      style={{
        position: 'sticky',
        top: 8,
        zIndex: 35,
        padding: '10px 14px',
        borderRadius: 12,
        border: '1px solid var(--line-strong)',
        background: 'var(--bug-bg)',
        color: 'var(--bug-fg)',
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      Нет связи с сервером. Можно читать, править получится, когда связь вернётся.
      {unsent && ' Неотправленные правки сохранены и уйдут сами.'}
    </div>
  )
}

/** Есть ли неотправленный текст: пока полоска на экране, проверяется раз в секунду */
function useUnsent(active: boolean): boolean {
  const [has, setHas] = useState(false)
  useEffect(() => {
    if (!active) return
    const check = () => setHas(unsentCount() > 0)
    check()
    const timer = setInterval(check, 1000)
    return () => clearInterval(timer)
  }, [active])
  return active && has
}
