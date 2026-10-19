import type { ReactNode } from 'react'
import { Sq } from './Shapes'

type PageHeadProps = {
  projectName: string
  /** Цвет квадрата проекта: `var(--accent)` и т.п. */
  projectColor: string
  title: string
  subtitle: string
  /** Справа от заголовка (поле «Название нового модуля» и т.п.) */
  children?: ReactNode
}

/** Шапка экрана проекта: крошка с цветом проекта, заголовок и описание (.head в макете) */
export function PageHead({ projectName, projectColor, title, subtitle, children }: PageHeadProps) {
  return (
    <header className="head">
      <div className="head-l">
        <div className="crumb">
          <Sq color={projectColor} />
          <span>{projectName}</span>
        </div>
        <h1 className="h1">{title}</h1>
        <p className="sub">{subtitle}</p>
      </div>
      {children}
    </header>
  )
}
