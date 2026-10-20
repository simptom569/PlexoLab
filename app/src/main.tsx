import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './styles/styles.css'
import './styles/shell.css'
import './styles/scrollbar.css'
import './styles/settings.css'
import App from './App.tsx'
import { loadSettings } from './lib/settings'
import { useSession } from './lib/session'
import { hydrateUi } from './lib/ui-store'
import { hydrateActivity } from './features/activity/store'
import { hydrateDocs } from './features/docs/store'
import { hydrateWiki } from './features/wiki/store'

async function start() {
  // Настройки читаем до показа интерфейса: тема и открытая страница сразу правильные
  const settings = await loadSettings()
  hydrateUi(settings)
  hydrateWiki(settings)
  hydrateDocs(settings)
  hydrateActivity(settings)
  // Вход по сохранённому токену запускаем один раз и вне React, иначе StrictMode в разработке запустил бы его дважды,
  // а refresh-токен одноразовый
  void useSession.getState().boot()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start()
