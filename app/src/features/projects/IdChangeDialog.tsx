import { Button } from '../../components'
import { idsChangeText } from '../../lib/task-ids'
import { DialogFrame } from './parts'

type Props = {
  /** Сколько задач сменят id */
  count: number
  /** Что именно произойдёт с номерами */
  detail: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * «У N задач изменятся id. Продолжить?»: спрашиваем перед сменой ключа модуля или проекта, если от неё у задач меняются
 * id (docs/PROJECTS.md, раздел 3). Окно ложится поверх другого окна, если ключ меняют в «Настройках проекта».
 */
export function IdChangeDialog({ count, detail, onConfirm, onCancel }: Props) {
  return (
    <DialogFrame title={idsChangeText(count)} narrow nested onClose={onCancel}>
      <p className="set-desc" style={{ margin: '12px 0 0' }}>
        {detail}
      </p>
      <p style={{ margin: '12px 0 0', fontWeight: 600 }}>Продолжить?</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <Button variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
        <Button variant="primary" onClick={onConfirm}>
          Продолжить
        </Button>
      </div>
    </DialogFrame>
  )
}
