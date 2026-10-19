import { useWiki } from '../../lib/api/queries'
import { useUi } from '../../lib/ui-store'
import { findByTitle } from './logic'
import { useCreatePageOnce } from './mutations'
import { useWikiStore } from './store'

/**
 * Переход по ссылке `[[Страница]]` (openWiki в макете): открывает страницу, а если такой нет, создаёт её с этим
 * названием и сразу открывает с курсором. Годится и для редактора документов.
 */
export function useOpenWikiLink() {
  const pages = useWiki().data
  const create = useCreatePageOnce()
  return (title: string) => {
    const name = title.trim()
    const found = pages && findByTitle(pages, name)
    if (found) {
      useWikiStore.getState().openPage(found.id)
      useUi.getState().setPage('wiki')
    } else {
      create(null, name, () => useUi.getState().setPage('wiki'))
    }
  }
}
