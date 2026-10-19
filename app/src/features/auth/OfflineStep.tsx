import { Button } from '../../components'
import { shortServerName } from '../../lib/api/serverUrl'
import { useSession } from '../../lib/session'
import { AuthLayout } from './AuthLayout'

/** Сервер не отвечает при запуске. Вход сохранён, поэтому его не теряем, а предлагаем повторить. */
export function OfflineStep() {
  const { serverUrl, offlineMessage, retry, changeServer } = useSession()
  return (
    <AuthLayout
      title="Нет связи с сервером"
      hint={
        <>
          {offlineMessage || 'Сервер не отвечает'}. Адрес: <span className="mono">{shortServerName(serverUrl ?? '')}</span>
        </>
      }
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="ghost" onClick={changeServer}>
          Сменить сервер
        </Button>
        <Button variant="primary" onClick={() => void retry()}>
          Повторить
        </Button>
      </div>
    </AuthLayout>
  )
}
