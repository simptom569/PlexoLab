import { Segmented } from '../../../components'
import type { ScrollbarMode, Theme } from '../../../lib/settings'
import { useUi } from '../../../lib/ui-store'
import { SettingGroup, SettingRow } from '../SettingRow'

const THEMES: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
  { value: 'system', label: 'Как в системе' },
]

const SCROLLBARS: ReadonlyArray<{ value: ScrollbarMode; label: string }> = [
  { value: 'visible', label: 'Видимые' },
  { value: 'quiet', label: 'Тихие' },
  { value: 'hidden', label: 'Скрытые' },
]

export function AppearanceSection() {
  const theme = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)
  const scrollbars = useUi((s) => s.scrollbars)
  const setScrollbars = useUi((s) => s.setScrollbars)

  return (
    <SettingGroup>
      <SettingRow label="Тема" description="Оформление окна. «Как в системе» следует настройке Windows.">
        <Segmented label="Тема" options={THEMES} value={theme} onChange={setTheme} />
      </SettingRow>
      <SettingRow
        label="Полосы прокрутки"
        description="Тихие появляются при наведении и прокрутке. Скрытые не видны совсем, листать можно колесом мыши и тачпадом."
      >
        <Segmented label="Полосы прокрутки" options={SCROLLBARS} value={scrollbars} onChange={setScrollbars} />
      </SettingRow>
    </SettingGroup>
  )
}
