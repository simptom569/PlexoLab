import { Button } from '../../../components'
import { BrandIcon } from '../../../components/Brand'
import { SettingGroup, SettingRow } from '../SettingRow'

// Версия из src-tauri/tauri.conf.json; когда дойдём до этапа 9, берём её у самого приложения (getVersion)
const APP_VERSION = '0.1.0'

export function AboutSection() {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <BrandIcon />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
          <strong style={{ fontSize: 15 }}>PlexoLab</strong>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Рабочее пространство</span>
        </div>
      </div>
      <SettingGroup>
        <SettingRow label="Версия приложения">
          <span className="mono" style={{ fontSize: 13 }}>
            {APP_VERSION}
          </span>
        </SettingRow>
        <SettingRow soon label="Обновления" description="Приложение само проверит, вышла ли новая версия.">
          <Button disabled>Проверить обновления</Button>
        </SettingRow>
      </SettingGroup>
    </>
  )
}
