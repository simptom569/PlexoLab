import { useEffect, useState } from 'react'
import { Switch } from '../../../components'
import { isAutostartEnabled, setAutostart } from '../../../lib/platform/desktop'
import { isTauri } from '../../../lib/platform/runtime'
import { useUi } from '../../../lib/ui-store'
import { Problem } from '../../projects/parts'
import { SettingGroup, SettingRow } from '../SettingRow'

/**
 * Поведение приложения в Windows. Запуск вместе с Windows хранит сама система (запись в реестре), поэтому его состояние
 * читаем у неё; «Сворачивать в трей» — обычная локальная настройка. В браузере (разработка, тесты) запуска с Windows нет.
 */
export function AppSection() {
  const closeToTray = useUi((s) => s.closeToTray)
  const setCloseToTray = useUi((s) => s.setCloseToTray)
  const desktop = isTauri()
  // null — ещё спрашиваем систему
  const [autostart, setAuto] = useState<boolean | null>(null)
  const [problem, setProblem] = useState(false)

  useEffect(() => {
    if (!desktop) return
    let alive = true
    isAutostartEnabled()
      .then((on) => alive && setAuto(on))
      .catch(() => alive && setProblem(true))
    return () => {
      alive = false
    }
  }, [desktop])

  const toggleAutostart = async (on: boolean) => {
    setProblem(false)
    try {
      await setAutostart(on)
      // показываем то, что записала система, а не то, что мы просили
      setAuto(await isAutostartEnabled())
    } catch {
      setProblem(true)
    }
  }

  return (
    <SettingGroup>
      <SettingRow
        label="Запускать вместе с Windows"
        description={
          <>
            Приложение запустится при входе в систему и будет ждать в области уведомлений, окно откроется по значку рядом с часами.
            {!desktop && ' Работает только в приложении для Windows.'}
            {problem && <Problem>Не удалось изменить запуск вместе с Windows</Problem>}
          </>
        }
      >
        <Switch label="Запускать вместе с Windows" checked={autostart ?? false} disabled={!desktop || autostart === null} onChange={toggleAutostart} />
      </SettingRow>
      <SettingRow
        label="Сворачивать в трей при закрытии"
        description="Крестик на окне прячет приложение в область уведомлений, и оно продолжает работать: окошки о новых уведомлениях приходят, пока окно закрыто. Выйти совсем можно из меню значка в трее."
      >
        <Switch label="Сворачивать в трей при закрытии" checked={closeToTray} onChange={setCloseToTray} />
      </SettingRow>
    </SettingGroup>
  )
}
