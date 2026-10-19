// Временные данные из seed() макета, пока нет API (подключается на этапе 3).
import type { SidebarProject, SidebarUser } from '../../components/Sidebar'

export const DEMO_PROJECTS: SidebarProject[] = [
  { id: 'web', name: 'Web-приложение', color: 'var(--accent)' },
  { id: 'api', name: 'Мобильный API', color: 'var(--warn)' },
  { id: 'infra', name: 'Инфраструктура', color: 'var(--ok)' },
]

export const DEMO_USER: SidebarUser = { name: 'Лена М.', role: 'Frontend', tone: 0 }

export const DEMO_BACKLOG_COUNT = 5
