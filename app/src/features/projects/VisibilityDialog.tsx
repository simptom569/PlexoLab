import { Button } from '../../components'
import { visibilityChangeDetail, visibilityChangeText } from '../../lib/project-dialogs'
import type { Visibility } from '../../lib/team-dialogs'
import { DialogFrame } from './parts'

type Props = {
  /** Какую видимость включают */
  to: Visibility
  /** Сколько человек это затронет (считает сервер) */
  people: number
  onConfirm: () => void
  onCancel: () => void
}

/**
 * «Проект увидят N членов команды» / «Доступ потеряют N человек»: спрашиваем перед сменой видимости проекта (docs/TEAMS.md, 3.4).
 * Окно ложится поверх «Настроек проекта», как вопрос про смену id задач.
 */
export function VisibilityDialog({ to, people, onConfirm, onCancel }: Props) {
  return (
    <DialogFrame title={visibilityChangeText(to, people)} narrow nested onClose={onCancel}>
      <p className="set-desc" style={{ margin: '12px 0 0' }}>
        {visibilityChangeDetail(to)}
      </p>
      <p style={{ margin: '12px 0 0', fontWeight: 600 }}>Продолжить?</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <Button variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
        <Button write variant="primary" onClick={onConfirm}>
          Продолжить
        </Button>
      </div>
    </DialogFrame>
  )
}
