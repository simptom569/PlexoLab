import { DocView } from './DocView'
import { DocsList } from './DocsList'
import { useDocsStore } from './store'

/** Экран «Документы»: список карточек или открытый документ (страница или холст) */
export function DocsScreen() {
  const docId = useDocsStore((s) => s.docId)
  return docId ? <DocView id={docId} /> : <DocsList />
}
