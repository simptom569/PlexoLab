import { useState, type ReactNode } from 'react'
import { Avatar, Button, Input } from '../../../components'
import { useSession } from '../../../lib/session'
import { SettingGroup, SettingRow } from '../SettingRow'

// users.tone 0..4 → цвета аватара (.av-a … .av-e)
const TONES = [
  { name: 'Синий', color: 'var(--a-fg)' },
  { name: 'Розовый', color: 'var(--b-fg)' },
  { name: 'Зелёный', color: 'var(--c-fg)' },
  { name: 'Жёлтый', color: 'var(--d-fg)' },
  { name: 'Фиолетовый', color: 'var(--e-fg)' },
]

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="f-row">
      <label className="f-label" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="f-val">{children}</div>
    </div>
  )
}

export function AccountSection() {
  const user = useSession((s) => s.user)
  const [name, setName] = useState(user?.name ?? '')
  const [role, setRole] = useState(user?.role ?? '')
  const [tone, setTone] = useState(user?.tone ?? 0)
  const [passwordOpen, setPasswordOpen] = useState(false)
  if (!user) return null

  return (
    <>
      <section>
        <h3 className="sec-title">Профиль</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <Avatar name={name || user.name} tone={tone} size="lg" decorative />
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, minWidth: 0 }}>
            <strong style={{ fontSize: 14 }}>{name || user.name}</strong>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{role}</span>
          </span>
        </div>
        <div className="fields">
          <Field label="Имя" htmlFor="set-name">
            <Input id="set-name" style={{ flex: '1 1 220px', maxWidth: 360 }} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Роль" htmlFor="set-role">
            <Input id="set-role" style={{ flex: '1 1 220px', maxWidth: 360 }} value={role} onChange={(e) => setRole(e.target.value)} />
          </Field>
          <Field label="E-mail">
            <span style={{ paddingTop: 6 }}>{user.email}</span>
          </Field>
          <div className="f-row">
            <span className="f-label" id="set-tone-label">
              Цвет аватара
            </span>
            <div className="f-val" role="group" aria-labelledby="set-tone-label" style={{ gap: 8, paddingTop: 6 }}>
              {TONES.map((t, i) => (
                <button
                  key={t.name}
                  className={i === tone ? 'sw-btn on' : 'sw-btn'}
                  type="button"
                  aria-label={t.name}
                  aria-pressed={i === tone}
                  style={{ background: t.color }}
                  onClick={() => setTone(i)}
                />
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <Button variant="primary">Сохранить</Button>
        </div>
      </section>

      <section>
        <h3 className="sec-title">Пароль</h3>
        <div className="set-list">
          <SettingRow label="Пароль для входа" description="Сменить можно, зная текущий пароль.">
            <Button aria-expanded={passwordOpen} onClick={() => setPasswordOpen((open) => !open)}>
              {passwordOpen ? 'Отмена' : 'Сменить пароль'}
            </Button>
          </SettingRow>
        </div>
        {passwordOpen && (
          <div className="fields" style={{ marginTop: 8 }}>
            <Field label="Текущий" htmlFor="set-pass-old">
              <Input id="set-pass-old" type="password" autoComplete="current-password" style={{ flex: '1 1 220px', maxWidth: 360 }} />
            </Field>
            <Field label="Новый" htmlFor="set-pass-new">
              <Input id="set-pass-new" type="password" autoComplete="new-password" style={{ flex: '1 1 220px', maxWidth: 360 }} />
            </Field>
            <Field label="Ещё раз" htmlFor="set-pass-again">
              <Input id="set-pass-again" type="password" autoComplete="new-password" style={{ flex: '1 1 220px', maxWidth: 360 }} />
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="primary">Сохранить пароль</Button>
            </div>
          </div>
        )}
      </section>

      <SettingGroup title="Выход">
        <SettingRow label="Выйти на этом компьютере" description="Входы на других компьютерах сохранятся.">
          <Button>Выйти</Button>
        </SettingRow>
        <SettingRow label="Выйти на всех устройствах" description="Завершит все входы, в том числе этот. Войти придётся заново.">
          <Button danger>Выйти везде</Button>
        </SettingRow>
      </SettingGroup>
    </>
  )
}
