import { useState } from 'react'
import { Button, Switch } from '../../../components'
import { CONNECTION_VIEW } from '../../../lib/connection-view'
import type { ConnectionStatus } from '../../../lib/realtime/connection'
import { useSession } from '../../../lib/session'
import { SettingGroup, SettingRow } from '../SettingRow'

export function ServerSection({ connection }: { connection: ConnectionStatus }) {
  const serverUrl = useSession((s) => s.serverUrl)
  const [live, setLive] = useState(true)
  const { color, label } = CONNECTION_VIEW[connection]
  return (
    <SettingGroup>
      <SettingRow label="Адрес сервера" description={<span className="mono">{serverUrl}</span>}>
        <Button>Сменить сервер</Button>
      </SettingRow>
      <SettingRow
        label="Связь"
        description={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className="sw" style={{ background: color }} />
            {label}
          </span>
        }
      >
        <Button>Проверить связь</Button>
      </SettingRow>
      <SettingRow label="Обновлять вживую" description="Чужие изменения появляются сразу, без перезагрузки экрана.">
        <Switch label="Обновлять вживую" checked={live} onChange={setLive} />
      </SettingRow>
    </SettingGroup>
  )
}
