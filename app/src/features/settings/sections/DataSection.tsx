import { useState } from 'react'
import { Button } from '../../../components'
import { useUi } from '../../../lib/ui-store'
import { resetLocalSettings } from '../reset'
import { SettingGroup, SettingRow } from '../SettingRow'

type Reset = 'view' | 'all'

export function DataSection() {
  const resetView = useUi((s) => s.resetView)
  // Как у «Удалить»: первое нажатие спрашивает «Точно?», второе выполняет. Рядом коротко пишем, что сделано.
  const [confirm, setConfirm] = useState<Reset | null>(null)
  const [done, setDone] = useState<Reset | null>(null)

  const press = (key: Reset, run: () => void) => () => {
    if (confirm === key) {
      run()
      setConfirm(null)
      setDone(key)
    } else {
      setConfirm(key)
      setDone(null)
    }
  }

  return (
    <SettingGroup>
      <SettingRow label="Сбросить фильтры и вид" description="Поиск, фильтры, вид задач и «Отображение» карточки вернутся к значениям по умолчанию.">
        {done === 'view' && (
          <span role="status" className="set-desc" style={{ margin: 0 }}>
            Готово
          </span>
        )}
        <Button onClick={press('view', resetView)}>{confirm === 'view' ? 'Точно сбросить?' : 'Сбросить'}</Button>
      </SettingRow>
      <SettingRow
        label="Сбросить все локальные настройки"
        description="Тема, полосы прокрутки, фильтры, вид и открытые страницы. Адрес сервера и вход сохранятся."
      >
        {done === 'all' && (
          <span role="status" className="set-desc" style={{ margin: 0 }}>
            Готово
          </span>
        )}
        <Button danger onClick={press('all', resetLocalSettings)}>
          {confirm === 'all' ? 'Точно сбросить?' : 'Сбросить всё'}
        </Button>
      </SettingRow>
    </SettingGroup>
  )
}
