import type { ReactNode } from 'react'
import { Count } from '../../components'

/** Блок настроек с заголовком: строки лежат одна под другой, между ними тонкая линия */
export function SettingGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section>
      {title && <h3 className="sec-title">{title}</h3>}
      <div className="set-list">{children}</div>
    </section>
  )
}

type SettingRowProps = {
  label: string
  description?: ReactNode
  /** Настройка ещё не работает: рядом метка «Скоро» */
  soon?: boolean
  /** Элемент управления справа */
  children: ReactNode
}

export function SettingRow({ label, description, soon, children }: SettingRowProps) {
  return (
    <div className="set-row">
      <div className="set-text">
        <div className="set-label">
          {label}
          {soon && <Count>Скоро</Count>}
        </div>
        {description && <div className="set-desc">{description}</div>}
      </div>
      <div className="set-ctl">{children}</div>
    </div>
  )
}
