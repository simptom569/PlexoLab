import { useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { Icon, IconButton, type IconName } from '../../components'
import { cx } from '../../lib/cx'
import type { ConnectionStatus } from '../../lib/realtime/connection'
import { SETTINGS_TABS, SETTINGS_TAB_LABELS, type SettingsTab } from '../../lib/settings-tabs'
import { useUi } from '../../lib/ui-store'
import { AboutSection } from './sections/AboutSection'
import { AccountSection } from './sections/AccountSection'
import { AppSection } from './sections/AppSection'
import { AppearanceSection } from './sections/AppearanceSection'
import { BoardSection } from './sections/BoardSection'
import { DataSection } from './sections/DataSection'
import { HotkeysSection } from './sections/HotkeysSection'
import { ServerSection } from './sections/ServerSection'
import { useDialogFocus } from './useDialogFocus'

type SectionProps = { connection: ConnectionStatus }

const SECTIONS: Record<SettingsTab, (props: SectionProps) => ReactNode> = {
  account: AccountSection,
  appearance: AppearanceSection,
  board: BoardSection,
  server: ServerSection,
  data: DataSection,
  app: AppSection,
  hotkeys: HotkeysSection,
  about: AboutSection,
}

// Иконки категорий, как у пунктов бокового меню. «Доска» — та же иконка, что в боковом меню, остальные нарисованы в стиле макета.
const TAB_ICONS: Record<SettingsTab, IconName> = {
  account: 'user',
  appearance: 'palette',
  board: 'board',
  server: 'server',
  data: 'database',
  app: 'window',
  hotkeys: 'keyboard',
  about: 'info',
}

const tabId = (tab: SettingsTab) => `set-tab-${tab}`
const PANEL_ID = 'set-panel'

// Стрелки переключают категории (вертикальный список, в узком окне — строка), Home и End — первая и последняя
const STEP: Partial<Record<string, 1 | -1>> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }

/** Окно «Настройки»: категории слева, содержимое справа, поверх всего приложения */
export function SettingsModal({
  tab,
  connection,
  returnFocus,
}: {
  tab: SettingsTab
  connection: ConnectionStatus
  /** Элемент, на который вернуть фокус при закрытии (карточка пользователя) */
  returnFocus: RefObject<HTMLElement | null>
}) {
  const closeSettings = useUi((s) => s.closeSettings)
  const setSettingsTab = useUi((s) => s.setSettingsTab)
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(dialogRef, closeSettings, returnFocus)

  const onTabKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const count = SETTINGS_TABS.length
    const index = SETTINGS_TABS.indexOf(tab)
    const step = STEP[e.key]
    const next = step ? (index + step + count) % count : e.key === 'Home' ? 0 : e.key === 'End' ? count - 1 : null
    if (next === null) return
    e.preventDefault()
    setSettingsTab(SETTINGS_TABS[next])
    document.getElementById(tabId(SETTINGS_TABS[next]))?.focus()
  }

  const Section = SECTIONS[tab]
  return (
    <>
      <button className="scrim set-scrim" type="button" aria-label="Закрыть настройки" onClick={closeSettings} />
      <div ref={dialogRef} className="set-dialog" role="dialog" aria-modal="true" aria-label="Настройки" tabIndex={-1}>
        <div className="set-nav">
          <div className="set-nav-title">Настройки</div>
          <div className="set-tabs" role="tablist" aria-orientation="vertical" aria-label="Категории настроек" onKeyDown={onTabKeys}>
            {SETTINGS_TABS.map((t) => (
              <button
                key={t}
                id={tabId(t)}
                className={cx('nav', t === tab && 'on')}
                type="button"
                role="tab"
                aria-selected={t === tab}
                aria-controls={t === tab ? PANEL_ID : undefined}
                tabIndex={t === tab ? 0 : -1}
                onClick={() => setSettingsTab(t)}
              >
                <Icon name={TAB_ICONS[t]} />
                {SETTINGS_TAB_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
        <div className="set-main">
          <IconButton className="set-close" icon="close" label="Закрыть настройки" onClick={closeSettings} />
          <div key={tab} id={PANEL_ID} className="dr-body" role="tabpanel" aria-labelledby={tabId(tab)}>
            <h2 className="set-title">{SETTINGS_TAB_LABELS[tab]}</h2>
            <Section connection={connection} />
          </div>
        </div>
      </div>
    </>
  )
}
