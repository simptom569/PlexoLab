import { Button } from '../../../components'
import { BrandIcon } from '../../../components/Brand'
import { isTauri } from '../../../lib/platform/runtime'
import { updateView } from '../../updates/logic'
import { useUpdates } from '../../updates/store'
import { Problem } from '../../projects/parts'
import { SettingGroup, SettingRow } from '../SettingRow'

export function AboutSection() {
  const phase = useUpdates((s) => s.phase)
  const view = updateView(phase, isTauri())

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
            {__APP_VERSION__}
          </span>
        </SettingRow>
        <SettingRow
          label="Обновления"
          description={
            <>
              {view.description}
              {view.problem && <Problem>{view.problem}</Problem>}
            </>
          }
        >
          <Button
            variant={view.button.primary ? 'primary' : undefined}
            disabled={view.button.disabled}
            onClick={() => void (view.button.action === 'install' ? useUpdates.getState().install() : useUpdates.getState().check())}
          >
            {view.button.label}
          </Button>
        </SettingRow>
      </SettingGroup>
    </>
  )
}
