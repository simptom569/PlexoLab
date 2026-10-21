import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Button, Icon, IconButton, type IconName } from '../../components'
import { cx } from '../../lib/cx'
import { useDialogFocus } from '../../lib/useDialogFocus'
import { useUi } from '../../lib/ui-store'

// Общие детали окон проектов. Окно устроено как окно «Настройки» (features/settings/SettingsModal.tsx): подложка, окно с
// необязательными вкладками слева, заголовок и крестик. Узкие окна (новый проект, приглашения, архив) без вкладок.

export type FrameTab<T extends string> = { id: T; label: string; icon: IconName }

type FrameProps<T extends string> = {
  /** Название окна: заголовок и подпись для скринридера */
  title: string
  onClose: () => void
  /** Узкое окно без вкладок */
  narrow?: boolean
  /** Вкладки слева; `navTitle` — маленький заголовок над ними */
  tabs?: { items: ReadonlyArray<FrameTab<T>>; current: T; onSelect: (tab: T) => void; navTitle: string }
  children: ReactNode
}

const STEP: Partial<Record<string, 1 | -1>> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }

export function DialogFrame<T extends string>({ title, onClose, narrow, tabs, children }: FrameProps<T>) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(dialogRef, onClose)

  const onTabKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!tabs) return
    const count = tabs.items.length
    const index = tabs.items.findIndex((t) => t.id === tabs.current)
    const step = STEP[e.key]
    const next = step ? (index + step + count) % count : e.key === 'Home' ? 0 : e.key === 'End' ? count - 1 : null
    if (next === null) return
    e.preventDefault()
    tabs.onSelect(tabs.items[next].id)
    document.getElementById(`proj-tab-${tabs.items[next].id}`)?.focus()
  }

  return (
    <>
      <button className="scrim set-scrim" type="button" aria-label={`Закрыть: ${title}`} onClick={onClose} />
      <div ref={dialogRef} className={cx('set-dialog', narrow && 'narrow')} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        {tabs && (
          <div className="set-nav">
            <div className="set-nav-title">{tabs.navTitle}</div>
            <div className="set-tabs" role="tablist" aria-orientation="vertical" aria-label={`Разделы: ${title}`} onKeyDown={onTabKeys}>
              {tabs.items.map((t) => (
                <button
                  key={t.id}
                  id={`proj-tab-${t.id}`}
                  className={cx('nav', t.id === tabs.current && 'on')}
                  type="button"
                  role="tab"
                  aria-selected={t.id === tabs.current}
                  aria-controls={t.id === tabs.current ? 'proj-panel' : undefined}
                  tabIndex={t.id === tabs.current ? 0 : -1}
                  onClick={() => tabs.onSelect(t.id)}
                >
                  <Icon name={t.icon} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="set-main">
          <IconButton className="set-close" icon="close" label={`Закрыть: ${title}`} onClick={onClose} />
          <div
            key={tabs?.current}
            id="proj-panel"
            className="dr-body"
            role={tabs ? 'tabpanel' : undefined}
            aria-labelledby={tabs ? `proj-tab-${tabs.current}` : undefined}
          >
            <h2 className="set-title">{tabs ? (tabs.items.find((t) => t.id === tabs.current)?.label ?? title) : title}</h2>
            {children}
          </div>
        </div>
      </div>
    </>
  )
}

/** Строка формы «подпись и значение» (как в окне «Настройки») */
export function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="f-row">
      <label className="f-label" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="f-val">{children}</div>
    </div>
  )
}

/** Текст ошибки на месте, не плашкой */
export const Problem = ({ children }: { children: ReactNode }) => (
  <span role="alert" style={{ display: 'block', fontSize: 13, color: 'var(--bug-fg)' }}>
    {children}
  </span>
)

/**
 * Кнопка с подтверждением вторым нажатием («Убрать» → «Точно убрать?»), как «Удалить» у модулей и релизов. Одно
 * подтверждение на весь экран: второе нажатие в другом месте первое снимает.
 */
export function TwoStep({
  id,
  label,
  confirmLabel,
  onConfirm,
  disabled,
  variant = 'ghost',
}: {
  id: string
  label: string
  confirmLabel: string
  onConfirm: () => void
  disabled?: boolean
  variant?: 'ghost' | 'default'
}) {
  const confirm = useUi((s) => s.confirm)
  const setConfirm = useUi((s) => s.setConfirm)
  const armed = confirm === id
  return (
    <Button
      variant={variant}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setConfirm(null)
          onConfirm()
        } else setConfirm(id)
      }}
    >
      {armed ? confirmLabel : label}
    </Button>
  )
}
