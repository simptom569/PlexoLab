import type { ReactNode } from 'react'
import { ThemeRoot } from '../../components/AppShell'
import { BrandIcon } from '../../components/Brand'
import { useDark } from '../../lib/useDark'

type AuthLayoutProps = {
  title: string
  /** Пояснение под заголовком */
  hint?: ReactNode
  children: ReactNode
}

/** Экраны до входа: карточка по центру на фоне приложения. Тема та же, что выбрана в приложении. */
export function AuthLayout({ title, hint, children }: AuthLayoutProps) {
  const dark = useDark()
  return (
    <ThemeRoot dark={dark}>
      <main className="main" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <section className="panel" style={{ width: 'min(420px, 100%)', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BrandIcon />
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
              <strong style={{ fontSize: 15 }}>PlexoLab</strong>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Рабочее пространство</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 className="h1" style={{ fontSize: 24 }}>
              {title}
            </h1>
            {hint && <p className="sub">{hint}</p>}
          </div>
          {children}
        </section>
      </main>
    </ThemeRoot>
  )
}

/** Подпись над полем */
export function FieldLabel({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 13, color: 'var(--muted)' }}>{children}</span>
}

/** Текст ошибки под формой */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div role="alert" className="late" style={{ fontSize: 13 }}>
      {message}
    </div>
  )
}
