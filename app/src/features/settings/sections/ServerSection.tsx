import { useState } from 'react'
import { Button, Switch } from '../../../components'
import { pingServer } from '../../../lib/api/auth'
import { CONNECTION_VIEW } from '../../../lib/connection-view'
import type { ConnectionStatus } from '../../../lib/realtime/connection'
import { useSession } from '../../../lib/session'
import { useUi } from '../../../lib/ui-store'
import { SettingGroup, SettingRow } from '../SettingRow'

const LIVE_OFF = { color: 'var(--muted)', label: 'Обновление вживую выключено' }

/** Итог кнопки «Проверить связь»: что показать под состоянием связи */
type Check = { state: 'checking' } | { state: 'ok'; ms: number } | { state: 'fail'; text: string }

const checkText = (check: Check): string =>
  check.state === 'checking' ? 'Проверяю…' : check.state === 'ok' ? `Сервер ответил за ${check.ms} мс` : check.text

export function ServerSection({ connection }: { connection: ConnectionStatus }) {
  const serverUrl = useSession((s) => s.serverUrl)
  const changeServer = useSession((s) => s.changeServer)
  const live = useUi((s) => s.live)
  const setLive = useUi((s) => s.setLive)
  const [check, setCheck] = useState<Check | null>(null)
  const { color, label } = live ? CONNECTION_VIEW[connection] : LIVE_OFF

  const runCheck = async () => {
    if (!serverUrl) return
    setCheck({ state: 'checking' })
    try {
      setCheck({ state: 'ok', ms: await pingServer(serverUrl) })
    } catch (e) {
      setCheck({ state: 'fail', text: e instanceof Error ? e.message : 'Сервер не отвечает' })
    }
  }

  return (
    <SettingGroup>
      <SettingRow label="Адрес сервера" description={<span className="mono">{serverUrl}</span>}>
        <Button onClick={changeServer}>Сменить сервер</Button>
      </SettingRow>
      <SettingRow
        label="Связь"
        description={
          <>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="sw" style={{ background: color }} />
              {label}
            </span>
            {check && (
              <span role="status" style={{ display: 'block' }}>
                {checkText(check)}
              </span>
            )}
          </>
        }
      >
        <Button disabled={check?.state === 'checking'} onClick={runCheck}>
          Проверить связь
        </Button>
      </SettingRow>
      <SettingRow label="Обновлять вживую" description="Чужие изменения появляются сразу, без перезагрузки экрана.">
        <Switch label="Обновлять вживую" checked={live} onChange={setLive} />
      </SettingRow>
    </SettingGroup>
  )
}
