import { DocView } from './DocView'
import { DocsList } from './DocsList'
import { useDocsStore } from './store'

/** Экран «Документы» проекта: список карточек или открытый документ (страница или холст) */
export function DocsScreen({ projectId }: { projectId: string }) {
  const docId = useDocsStore((s) => s.docId)
  return docId ? <DocView id={docId} projectId={projectId} /> : <DocsList projectId={projectId} />
}
