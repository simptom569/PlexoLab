import { Button, Icon, IconButton, SearchField } from '../../components'
import { cx } from '../../lib/cx'
import type { WikiNode } from '../../lib/api/types'
import { treeRows } from './logic'
import { useCreatePageOnce } from './mutations'
import { useWikiStore } from './store'

type WikiTreeProps = {
  pages: WikiNode[]
  /** Открытая страница; null — открыта библиотека файлов */
  currentId: string | null
  fileTotal: number
}

/** Слева: поиск, «Файлы», дерево страниц и «Новая страница» (.tree в макете) */
export function WikiTree({ pages, currentId, fileTotal }: WikiTreeProps) {
  const { q, open, view, setQuery, toggleOpen, openPage, showFiles } = useWikiStore()
  const create = useCreatePageOnce()
  const rows = treeRows(pages, open, q)

  const add = (parentId: string | null) => create(parentId, '')

  return (
    <aside className="tree" aria-label="Страницы вики">
      <SearchField label="Поиск по страницам" placeholder="Поиск страниц" value={q} onChange={setQuery} style={{ minWidth: 0, flex: 'none' }} />
      <button className={cx('nav', view === 'files' && 'on')} type="button" onClick={showFiles}>
        <Icon name="folder" />
        <span style={{ flex: 1 }}>Файлы</span>
        <span className="count">{fileTotal}</span>
      </button>
      <div className="pop-title" style={{ margin: '6px 8px 0' }}>
        Страницы
      </div>
      <div role="tree" aria-label="Дерево страниц">
        {rows.map(({ node, depth, hasKids }) => {
          const title = node.title || 'Без названия'
          const expanded = !!open[node.id]
          return (
            <div key={node.id} className={cx('tr', currentId === node.id && 'on')} style={{ paddingLeft: 6 + depth * 16 }}>
              {hasKids ? (
                <button
                  className={cx('tr-caret', expanded && 'open')}
                  type="button"
                  aria-label="Развернуть или свернуть"
                  aria-expanded={expanded}
                  onClick={() => toggleOpen(node.id)}
                >
                  <Icon name="chevronRight" />
                </button>
              ) : (
                <span className="tr-spacer" />
              )}
              <button className="tr-title" type="button" role="treeitem" onClick={() => openPage(node.id)}>
                {title}
              </button>
              <IconButton className="tr-add" label={`Добавить вложенную страницу в ${title}`} icon="plus" small onClick={() => add(node.id)} />
            </div>
          )
        })}
        {rows.length === 0 && <div style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: 13 }}>Ничего не найдено</div>}
      </div>
      <Button onClick={() => add(null)}>
        <Icon name="plus" sm />
        Новая страница
      </Button>
    </aside>
  )
}
