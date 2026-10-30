import { useEffect, useState, type FormEvent } from 'react'
import { Button, Input } from '../../components'
import { fetchOptions } from '../../lib/api/auth'
import { ApiError } from '../../lib/api/client'
import { shortServerName } from '../../lib/api/serverUrl'
import type { AuthOptions } from '../../lib/api/types'
import { NetworkError } from '../../lib/platform/http'
import { useSession } from '../../lib/session'
import { AuthLayout, FieldLabel, FormError } from './AuthLayout'

/** Шаг 2: e-mail и пароль */
export function LoginStep() {
  const { serverUrl, lastEmail, login, changeServer, openCodeFlow } = useSession()
  const [email, setEmail] = useState(lastEmail)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Что умеет сервер: ссылки «Создать аккаунт» и «Забыли пароль?» появляются, только когда на нём настроена почта */
  const [options, setOptions] = useState<AuthOptions | null>(null)

  useEffect(() => {
    if (!serverUrl) return
    let alive = true
    void fetchOptions(serverUrl).then((o) => alive && setOptions(o))
    return () => {
      alive = false
    }
  }, [serverUrl])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
    } catch (err) {
      setPassword('')
      if (err instanceof ApiError && err.status === 401) setError('Неверный e-mail или пароль')
      else if (err instanceof NetworkError) setError(err.message)
      else setError(err instanceof Error ? err.message : 'Не удалось войти')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Вход"
      hint={
        <>
          Сервер: <span className="mono">{shortServerName(serverUrl ?? '')}</span>{' '}
          <button className="crumb-btn" type="button" onClick={changeServer} style={{ textDecoration: 'underline' }}>
            Сменить сервер
          </button>
        </>
      }
    >
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <FieldLabel>E-mail</FieldLabel>
          <Input
            type="email"
            autoFocus={!lastEmail}
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <FieldLabel>Пароль</FieldLabel>
          <Input
            type="password"
            autoFocus={!!lastEmail}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {options?.password_reset && (
          <button
            className="crumb-btn"
            type="button"
            onClick={() => openCodeFlow('reset', email)}
            style={{ alignSelf: 'flex-start', textDecoration: 'underline' }}
          >
            Забыли пароль?
          </button>
        )}
        <FormError message={error} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          {options?.registration ? (
            <button className="crumb-btn" type="button" onClick={() => openCodeFlow('register', email)} style={{ textDecoration: 'underline' }}>
              Создать аккаунт
            </button>
          ) : (
            <span />
          )}
          <Button variant="primary" type="submit" disabled={busy || !email.trim() || !password}>
            {busy ? 'Вхожу…' : 'Войти'}
          </Button>
        </div>
      </form>
    </AuthLayout>
  )
}
