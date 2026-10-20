import { Segmented } from '../../../components'
import type { WeekStart } from '../../../lib/settings'
import { useUi } from '../../../lib/ui-store'
import { SettingGroup, SettingRow } from '../SettingRow'

const WEEK_STARTS: ReadonlyArray<{ value: WeekStart; label: string }> = [
  { value: 'mon', label: 'Понедельник' },
  { value: 'sun', label: 'Воскресенье' },
]

export function BoardSection() {
  const weekStart = useUi((s) => s.weekStart)
  const setWeekStart = useUi((s) => s.setWeekStart)
  return (
    <SettingGroup>
      <SettingRow label="Первый день недели" description="С него начинаются неделя в календаре и диаграмме Ганта.">
        <Segmented label="Первый день недели" options={WEEK_STARTS} value={weekStart} onChange={setWeekStart} />
      </SettingRow>
    </SettingGroup>
  )
}
