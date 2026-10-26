import type { ReactNode } from 'react'
import { useUi } from '../lib/ui-store'
import { Button } from './Button'

/** «Удалить», после нажатия «Точно удалить?»; второе нажатие удаляет (confirmThen в макете). Одно подтверждение на весь экран. */
export function ConfirmDelete({ confirmKey, onConfirm, children }: { confirmKey: string; onConfirm: () => void; children?: ReactNode }) {
  const confirm = useUi((s) => s.confirm)
  const setConfirm = useUi((s) => s.setConfirm)
  return (
    <Button
      write
      variant="ghost"
      onClick={() => {
        if (confirm === confirmKey) {
          setConfirm(null)
          onConfirm()
        } else setConfirm(confirmKey)
      }}
    >
      {confirm === confirmKey ? 'Точно удалить?' : (children ?? 'Удалить')}
    </Button>
  )
}
