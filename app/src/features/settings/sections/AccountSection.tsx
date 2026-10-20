import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Avatar, Button, Input } from '../../../components'
import { keys } from '../../../lib/api/queries'
import { useSession } from '../../../lib/session'
import { checkPasswordForm } from '../password'
import { SettingGroup, SettingRow } from '../SettingRow'

// users.tone 0..4 → цвета аватара (.av-a … .av-e)
const TONES = [
  { name: 'Синий', color: 'var(--a-fg)' },
  { name: 'Розовый', color: 'var(--b-fg)' },
  { name: 'Зелёный', color: 'var(--c-fg)' },
  { name: 'Жёлтый', color: 'var(--d-fg)' },
  { name: 'Фиолетовый', color: 'var(--e-fg)' },
]

// Пределы сервера (domain::users)
const NAME_MAX = 60
const ROLE_MAX = 40

/** Текст ошибки для человека: у ApiError и NetworkError он уже написан по-русски */
const errorText = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'Не удалось выполнить')

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

const Problem = ({ children }: { children: ReactNode }) => (
  <span role="alert" style={{ display: 'block', fontSize: 13, color: 'var(--bug-fg)' }}>
    {children}
  </span>
)

type Saving = { state: 'idle' } | { state: 'saving' } | { state: 'saved' } | { state: 'error'; text: string }

export function AccountSection() {
  const user = useSession((s) => s.user)
  const updateProfile = useSession((s) => s.updateProfile)
  const changePassword = useSession((s) => s.changePassword)
  const logout = useSession((s) => s.logout)
  const queryClient = useQueryClient()

  const [name, setName] = useState(user?.name ?? '')
  const [role, setRole] = useState(user?.role ?? '')
  const [tone, setTone] = useState(user?.tone ?? 0)
  const [profile, setProfile] = useState<Saving>({ state: 'idle' })

  const [passwordOpen, setPasswordOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [password, setPassword] = useState<Saving>({ state: 'idle' })

  if (!user) return null

  const edited = (patch: () => void) => {
    patch()
    setProfile({ state: 'idle' })
  }
  const dirty = name.trim() !== user.name || role.trim() !== user.role || tone !== user.tone
  const canSave = dirty && name.trim() !== '' && profile.state !== 'saving'

  const saveProfile = async () => {
    setProfile({ state: 'saving' })
    try {
      await updateProfile({ name: name.trim(), role: role.trim(), tone })
      setName(name.trim())
      setRole(role.trim())
      // свой «user.changed» сервер нашему окну не присылает (метка клиента), список участников обновляем сами
      await queryClient.invalidateQueries({ queryKey: keys.users })
      setProfile({ state: 'saved' })
    } catch (e) {
      setProfile({ state: 'error', text: errorText(e) })
    }
  }

  const closePassword = () => {
    setPasswordOpen(false)
    setCurrent('')
    setNext('')
    setAgain('')
    setPassword((p) => (p.state === 'saved' ? p : { state: 'idle' }))
  }

  const savePassword = async () => {
    const problem = checkPasswordForm(current, next, again)
    if (problem) return setPassword({ state: 'error', text: problem })
    setPassword({ state: 'saving' })
    try {
      await changePassword(current, next)
      setPasswordOpen(false)
      setCurrent('')
      setNext('')
      setAgain('')
      setPassword({ state: 'saved' })
    } catch (e) {
      setPassword({ state: 'error', text: errorText(e) })
    }
  }

  return (
    <>
      <section>
        <h3 className="sec-title">Профиль</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <Avatar name={name.trim() || user.name} tone={tone} size="lg" decorative />
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, minWidth: 0 }}>
            <strong style={{ fontSize: 14 }}>{name.trim() || user.name}</strong>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{role.trim()}</span>
          </span>
        </div>
        <div className="fields">
          <Field label="Имя" htmlFor="set-name">
            <Input
              id="set-name"
              maxLength={NAME_MAX}
              style={{ flex: '1 1 220px', maxWidth: 360 }}
              value={name}
              onChange={(e) => edited(() => setName(e.target.value))}
            />
          </Field>
          <Field label="Роль" htmlFor="set-role">
            <Input
              id="set-role"
              maxLength={ROLE_MAX}
              style={{ flex: '1 1 220px', maxWidth: 360 }}
              value={role}
              onChange={(e) => edited(() => setRole(e.target.value))}
            />
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
                  onClick={() => edited(() => setTone(i))}
                />
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 16 }}>
          {profile.state === 'saved' && (
            <span role="status" className="set-desc" style={{ margin: 0 }}>
              Сохранено
            </span>
          )}
          {profile.state === 'error' && <Problem>{profile.text}</Problem>}
          <Button variant="primary" disabled={!canSave} onClick={saveProfile}>
            Сохранить
          </Button>
        </div>
      </section>

      <section>
        <h3 className="sec-title">Пароль</h3>
        <div className="set-list">
          <SettingRow
            label="Пароль для входа"
            description={
              password.state === 'saved' ? (
                <span role="status">Пароль изменён. Входы на других устройствах завершены.</span>
              ) : (
                'Сменить можно, зная текущий пароль.'
              )
            }
          >
            <Button aria-expanded={passwordOpen} onClick={() => (passwordOpen ? closePassword() : setPasswordOpen(true))}>
              {passwordOpen ? 'Отмена' : 'Сменить пароль'}
            </Button>
          </SettingRow>
        </div>
        {passwordOpen && (
          <form
            className="fields"
            style={{ marginTop: 8 }}
            onSubmit={(e) => {
              e.preventDefault()
              void savePassword()
            }}
          >
            <Field label="Текущий" htmlFor="set-pass-old">
              <Input
                id="set-pass-old"
                type="password"
                autoComplete="current-password"
                style={{ flex: '1 1 220px', maxWidth: 360 }}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </Field>
            <Field label="Новый" htmlFor="set-pass-new">
              <Input
                id="set-pass-new"
                type="password"
                autoComplete="new-password"
                style={{ flex: '1 1 220px', maxWidth: 360 }}
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </Field>
            <Field label="Ещё раз" htmlFor="set-pass-again">
              <Input
                id="set-pass-again"
                type="password"
                autoComplete="new-password"
                style={{ flex: '1 1 220px', maxWidth: 360 }}
                value={again}
                onChange={(e) => setAgain(e.target.value)}
              />
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
              {password.state === 'error' && <Problem>{password.text}</Problem>}
              <Button variant="primary" type="submit" disabled={password.state === 'saving'}>
                Сохранить пароль
              </Button>
            </div>
          </form>
        )}
      </section>

      <SettingGroup title="Выход">
        <SettingRow label="Выйти на этом компьютере" description="Входы на других компьютерах сохранятся.">
          <Button onClick={() => void logout()}>Выйти</Button>
        </SettingRow>
      </SettingGroup>
    </>
  )
}
