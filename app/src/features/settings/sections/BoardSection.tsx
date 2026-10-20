import { useState } from 'react'
import { Segmented } from '../../../components'
import { SettingGroup, SettingRow } from '../SettingRow'

type WeekStart = 'mon' | 'sun'

const WEEK_STARTS = [
  { value: 'mon', label: 'Понедельник' },
  { value: 'sun', label: 'Воскресенье' },
] as const

export function BoardSection() {
  const [weekStart, setWeekStart] = useState<WeekStart>('mon')
  return (
    <SettingGroup>
      <SettingRow label="Первый день недели" description="С него начинаются неделя в календаре и диаграмме Ганта.">
        <Segmented label="Первый день недели" options={WEEK_STARTS} value={weekStart} onChange={setWeekStart} />
      </SettingRow>
    </SettingGroup>
  )
}
