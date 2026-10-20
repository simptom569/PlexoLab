import { useState } from 'react'
import { Button } from '../../../components'
import { SettingGroup, SettingRow } from '../SettingRow'

type Reset = 'view' | 'all'

export function DataSection() {
  // Как у «Удалить»: первое нажатие спрашивает «Точно?», второе выполняет. Пока выполнять нечего.
  const [confirm, setConfirm] = useState<Reset | null>(null)
  const ask = (key: Reset) => setConfirm(confirm === key ? null : key)
  return (
    <SettingGroup>
      <SettingRow label="Сбросить фильтры и вид" description="Поиск, фильтры, вид задач и «Отображение» карточки вернутся к значениям по умолчанию.">
        <Button onClick={() => ask('view')}>{confirm === 'view' ? 'Точно сбросить?' : 'Сбросить'}</Button>
      </SettingRow>
      <SettingRow
        label="Сбросить все локальные настройки"
        description="Тема, полосы прокрутки, фильтры, вид и открытые страницы. Адрес сервера и вход сохранятся."
      >
        <Button danger onClick={() => ask('all')}>
          {confirm === 'all' ? 'Точно сбросить?' : 'Сбросить всё'}
        </Button>
      </SettingRow>
    </SettingGroup>
  )
}
