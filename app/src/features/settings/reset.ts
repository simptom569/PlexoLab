import { DEFAULT_SETTINGS } from '../../lib/settings'
import { hydrateUi, useUi } from '../../lib/ui-store'
import { hydrateActivity } from '../activity/store'
import { hydrateDocs } from '../docs/store'
import { hydrateWiki } from '../wiki/store'

/**
 * «Сбросить все локальные настройки»: всё, что хранится на этом компьютере (тема, полосы прокрутки, фильтры, вид,
 * открытые страницы), кроме адреса сервера и входа. Каждое хранилище само записывает своё новое значение на диск.
 */
export function resetLocalSettings(): void {
  hydrateUi(DEFAULT_SETTINGS)
  hydrateWiki(DEFAULT_SETTINGS)
  hydrateDocs(DEFAULT_SETTINGS)
  hydrateActivity(DEFAULT_SETTINGS)
  useUi.setState({ q: '', menu: null })
}
