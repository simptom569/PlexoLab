import { Button } from '../../components'
import { useCloseAsk } from '../../lib/closeAsk'
import { DialogFrame } from '../projects/parts'

/**
 * Вопрос при закрытии приложения, когда часть текста не успела уйти на сервер (lib/closeGuard.ts). В макете такого окна
 * нет, оно собрано из стилей окон «Настройки» и «Настройки проекта».
 */
export function CloseAskDialog() {
  const open = useCloseAsk((s) => s.open)
  const answer = useCloseAsk((s) => s.answer)
  if (!open) return null
  return (
    <DialogFrame title="Есть неотправленные правки" narrow onClose={() => answer(false)}>
      <p className="set-desc" style={{ margin: '12px 0 0' }}>
        Часть текста не ушла на сервер: пока нет связи, она хранится только в этом окне. Если закрыть приложение сейчас, она пропадёт.
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <Button variant="ghost" onClick={() => answer(true)}>
          Закрыть без отправки
        </Button>
        <Button variant="primary" onClick={() => answer(false)}>
          Остаться
        </Button>
      </div>
    </DialogFrame>
  )
}
