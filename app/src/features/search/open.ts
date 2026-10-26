// Открыть найденное: переключить проект и экран и показать запись. Порядок важен: смена проекта и экрана сбрасывает
// открытую задачу, поэтому саму запись открываем последней.

import { useUi } from '../../lib/ui-store'
import { useDocsStore } from '../docs/store'
import { useWikiStore } from '../wiki/store'
import type { SearchItem } from './logic'

export function openItem(item: SearchItem): void {
  const ui = useUi.getState()
  switch (item.kind) {
    case 'task':
      if (item.projectId) ui.setProject(item.projectId)
      ui.setPage('board')
      ui.openTask(item.id)
      break
    case 'doc':
      if (item.projectId) ui.setProject(item.projectId)
      ui.setPage('docs')
      useDocsStore.getState().openDoc(item.id)
      break
    case 'wiki':
      ui.setPage('wiki')
      useWikiStore.getState().openPage(item.id)
      break
    case 'file': {
      // файл лежит в библиотеке вики: открываем её с его именем в поиске, там он будет первым
      ui.setPage('wiki')
      const wiki = useWikiStore.getState()
      wiki.libraryRoot()
      wiki.setFileQuery(item.title)
      wiki.showFiles()
      break
    }
  }
  ui.closeProjectDialog()
}
