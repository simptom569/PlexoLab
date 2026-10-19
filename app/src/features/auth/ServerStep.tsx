import { useState, type FormEvent } from 'react'
import { Button, Input } from '../../components'
import { useSession } from '../../lib/session'
import { shortServerName } from '../../lib/api/serverUrl'
import { AuthLayout, FieldLabel, FormError } from './AuthLayout'

/** Шаг 1: адрес сервера команды */
export function ServerStep() {
  const chooseServer = useSession((s) => s.chooseServer)
  const known = useSession((s) => s.serverUrl)
  const [address, setAddress] = useState(known ? shortServerName(known) : '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await chooseServer(address)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось подключиться')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Адрес сервера" hint="Адрес вам сообщил администратор команды. Он нужен один раз.">
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <FieldLabel>Адрес сервера</FieldLabel>
          <Input
            autoFocus
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="например, 192.168.1.10:8080"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
          />
        </label>
        <FormError message={error} />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="primary" type="submit" disabled={busy || !address.trim()}>
            {busy ? 'Проверяю…' : 'Продолжить'}
          </Button>
        </div>
      </form>
    </AuthLayout>
  )
}
