import { useState } from 'react'
import { Segmented } from '../../../components'
import { useUi } from '../../../lib/ui-store'
import { SettingGroup, SettingRow } from '../SettingRow'

type ThemeChoice = 'light' | 'dark' | 'system'
type ScrollbarMode = 'visible' | 'quiet' | 'hidden'

const THEMES = [
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
  { value: 'system', label: 'Как в системе' },
] as const

const SCROLLBARS = [
  { value: 'visible', label: 'Видимые' },
  { value: 'quiet', label: 'Тихие' },
  { value: 'hidden', label: 'Скрытые' },
] as const

export function AppearanceSection() {
  const theme = useUi((s) => s.theme)
  const toggleTheme = useUi((s) => s.toggleTheme)
  // Пока только вид: светлая и тёмная уже работают, остальное лишь выбирается
  const [choice, setChoice] = useState<ThemeChoice>(theme)
  const [scrollbars, setScrollbars] = useState<ScrollbarMode>('visible')

  const chooseTheme = (next: ThemeChoice) => {
    setChoice(next)
    if (next !== 'system' && next !== theme) toggleTheme()
  }

  return (
    <SettingGroup>
      <SettingRow label="Тема" description="Оформление окна. «Как в системе» следует настройке Windows.">
        <Segmented label="Тема" options={THEMES} value={choice} onChange={chooseTheme} />
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
