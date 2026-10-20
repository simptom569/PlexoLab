import { Switch } from '../../../components'
import { SettingGroup, SettingRow } from '../SettingRow'

// Заглушка: настройки появятся вместе с этапом 9 (упаковка Tauri)
export function AppSection() {
  return (
    <SettingGroup>
      <SettingRow soon label="Запускать вместе с Windows" description="Приложение откроется само, когда вы входите в систему.">
        <Switch disabled label="Запускать вместе с Windows" checked={false} onChange={() => {}} />
      </SettingRow>
      <SettingRow soon label="Сворачивать в трей при закрытии" description="Окно закроется, а приложение останется в области уведомлений.">
        <Switch disabled label="Сворачивать в трей при закрытии" checked={false} onChange={() => {}} />
      </SettingRow>
    </SettingGroup>
  )
}
