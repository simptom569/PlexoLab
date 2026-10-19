import { Button } from './Button'

/**
 * Баннер конфликта: страницу или документ успел изменить другой участник. В макете такого элемента нет, собран из его
 * переменных.
 */
export function ConflictBanner({ message, onTheirs, onMine }: { message: string; onTheirs: () => void; onMine: () => void }) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        borderRadius: 12,
        border: '1px solid var(--line-strong)',
        background: 'var(--bug-bg)',
        color: 'var(--bug-fg)',
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      <span style={{ flex: 1, minWidth: 220 }}>{message}</span>
      <Button onClick={onTheirs}>Загрузить его версию</Button>
      <Button onClick={onMine}>Оставить мою</Button>
    </div>
  )
}
