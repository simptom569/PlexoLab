import { useEffect, useState, type FormEvent } from 'react'
import { Button, Input } from '../../components'
import { ApiError } from '../../lib/api/client'
import { NetworkError } from '../../lib/platform/http'
import { useSession, type CodeKind } from '../../lib/session'
import { AuthLayout, FieldLabel, FormError } from './AuthLayout'

/** Через сколько секунд можно попросить код ещё раз (столько же ждёт сервер: письмо на адрес не чаще раза в минуту) */
export const RESEND_SECONDS = 60
/** Пароль короче сервер не примет */
const MIN_PASSWORD = 8

const TEXT = {
  register: {
    emailTitle: 'Создание аккаунта',
    emailHint: 'Мы отправим на ваш e-mail код подтверждения.',
    codeTitle: 'Введите код',
    submit: 'Создать аккаунт',
    submitting: 'Создаю…',
    passwordLabel: 'Пароль (от 8 символов)',
  },
  reset: {
    emailTitle: 'Сброс пароля',
    emailHint: 'Укажите e-mail аккаунта, мы отправим на него код для сброса пароля.',
    codeTitle: 'Новый пароль',
    submit: 'Сменить пароль',
    submitting: 'Меняю…',
    passwordLabel: 'Новый пароль (от 8 символов)',
  },
} as const

/** Текст ошибки для человека: сервер пишет по-русски, у обрыва связи свой текст */
function describe(err: unknown): string {
  if (err instanceof ApiError || err instanceof NetworkError) return err.message
  return err instanceof Error ? err.message : 'Что-то пошло не так'
}

const column = { display: 'flex', flexDirection: 'column', gap: 14 } as const
const field = { display: 'flex', flexDirection: 'column', gap: 6 } as const
const link = { textDecoration: 'underline' } as const

/**
 * «Создать аккаунт» и «Забыли пароль?»: два шага, как на входе. Шаг 1: e-mail, на него приходит код из шести цифр.
 * Шаг 2: код и то, что нужно дальше (для регистрации имя и пароль, для сброса новый пароль). Правила кодов:
 * docs/REGISTRATION.md. Макета этих экранов нет, они собраны из деталей экрана входа.
 */
export function CodeFlow({ kind }: { kind: CodeKind }) {
  const { lastEmail, requestCode, register, resetPassword, backToLogin } = useSession()
  const text = TEXT[kind]
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState(lastEmail)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Куда уже отправлено письмо и сколько секунд осталось до новой отправки */
  const [sentTo, setSentTo] = useState('')
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const address = email.trim()

  async function sendCode(again: boolean) {
    // тот же адрес, письмо ушло меньше минуты назад: новое сервер не пришлёт, а код у человека уже есть
    if (!again && cooldown > 0 && sentTo.toLowerCase() === address.toLowerCase()) {
      setError(null)
      setStep('code')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await requestCode(kind, address)
      setSentTo(address)
      setCooldown(RESEND_SECONDS)
      setCode('')
      setStep('code')
      if (again) setNotice('Код отправлен ещё раз')
    } catch (err) {
      setError(describe(err))
    } finally {
      setBusy(false)
    }
  }

  async function submitEmail(e: FormEvent) {
    e.preventDefault()
    await sendCode(false)
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (kind === 'register') await register(address, code, name, password)
      else await resetPassword(address, code, password)
    } catch (err) {
      // с кодом не вышло: его набирают заново, а имя и пароль остаются, чтобы не вводить их ещё раз
      if (err instanceof ApiError && (err.code === 'wrong_code' || err.code === 'code_expired')) setCode('')
      setError(describe(err))
    } finally {
      setBusy(false)
    }
  }

  function changeEmail() {
    setStep('email')
    setError(null)
    setNotice(null)
  }

  if (step === 'email') {
    return (
      <AuthLayout title={text.emailTitle} hint={text.emailHint}>
        <form onSubmit={submitEmail} style={column}>
          <label style={field}>
            <FieldLabel>E-mail</FieldLabel>
            <Input
              type="email"
              autoFocus
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </label>
          <FormError message={error} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <button className="crumb-btn" type="button" onClick={() => backToLogin(email)} style={link}>
              Вернуться ко входу
            </button>
            <Button variant="primary" type="submit" disabled={busy || !address}>
              {busy ? 'Отправляю…' : 'Получить код'}
            </Button>
          </div>
        </form>
      </AuthLayout>
    )
  }

  const ready = code.length === 6 && password.length >= MIN_PASSWORD && (kind === 'reset' || name.trim() !== '')
  const hint =
    kind === 'register' ? (
      <>
        Код отправлен на <span className="mono">{sentTo}</span>. Он действует 15 минут.
      </>
    ) : (
      <>
        Если аккаунт с адресом <span className="mono">{sentTo}</span> есть, мы отправили на него код. Он действует 15 минут.
      </>
    )

  return (
    <AuthLayout title={text.codeTitle} hint={hint}>
      <form onSubmit={submitCode} style={column}>
        <label style={field}>
          <FieldLabel>Код из письма</FieldLabel>
          <Input
            className="mono"
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            spellCheck={false}
            value={code}
            // вставленное «123 456» и «123-456» остаётся шестью цифрами
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
          />
        </label>
        {kind === 'register' && (
          <label style={field}>
            <FieldLabel>Как вас зовут</FieldLabel>
            <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Лена М." maxLength={60} />
          </label>
        )}
        <label style={field}>
          <FieldLabel>{text.passwordLabel}</FieldLabel>
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {notice && (
          <div role="status" style={{ fontSize: 13, color: 'var(--muted)' }}>
            {notice}
          </div>
        )}
        <FormError message={error} />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="primary" type="submit" disabled={busy || !ready}>
            {busy ? text.submitting : text.submit}
          </Button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 16px' }}>
          <button className="crumb-btn" type="button" disabled={busy || cooldown > 0} onClick={() => void sendCode(true)} style={link}>
            {cooldown > 0 ? `Отправить ещё раз через ${cooldown} с` : 'Отправить код ещё раз'}
          </button>
          <button className="crumb-btn" type="button" onClick={changeEmail} style={link}>
            Изменить e-mail
          </button>
          <button className="crumb-btn" type="button" onClick={() => backToLogin(email)} style={link}>
            Вернуться ко входу
          </button>
        </div>
      </form>
    </AuthLayout>
  )
}
