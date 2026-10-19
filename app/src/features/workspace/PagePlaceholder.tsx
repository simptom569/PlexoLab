import { EmptyState } from '../../components'
import { PAGE_LABELS, type PageId } from '../../lib/pages'

/** Заглушка экрана: настоящие экраны переносятся из макета на этапах 3–7. */
export function PagePlaceholder({ page }: { page: PageId }) {
  return (
    <>
      <header className="head">
        <div className="head-l">
          <h1 className="h1">{PAGE_LABELS[page]}</h1>
        </div>
      </header>
      <EmptyState>Экран «{PAGE_LABELS[page]}» будет перенесён из макета на следующих этапах</EmptyState>
    </>
  )
}
