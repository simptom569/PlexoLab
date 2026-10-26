import { useEffect } from 'react'
import { useToast } from '../lib/toast'

/**
 * Плашка снизу: «Не удалось сохранить…». В макете такого элемента нет (решение владельца, этап 4),
 * поэтому собрана только из его переменных: красный тон меток «Баг», рамка, радиус и тень как у карточки и поповера.
 */
export function Toast() {
  const message = useToast((s) => s.message)
  const ms = useToast((s) => s.ms)
  const seq = useToast((s) => s.seq)
  const hide = useToast((s) => s.hide)

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(hide, ms)
    return () => clearTimeout(timer)
  }, [message, ms, seq, hide])

  if (!message) return null
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 24,
        transform: 'translateX(-50%)',
        zIndex: 80,
        maxWidth: 'min(480px, 90vw)',
        padding: '10px 16px',
        borderRadius: 12,
        border: '1px solid var(--line-strong)',
        background: 'var(--bug-bg)',
        color: 'var(--bug-fg)',
        fontSize: 13,
        fontWeight: 600,
        boxShadow: '0 14px 36px rgba(15,20,35,.2)',
      }}
    >
      {message}
    </div>
  )
}
