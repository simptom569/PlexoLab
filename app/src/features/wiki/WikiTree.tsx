import { Fragment, type CSSProperties } from 'react'
import { Button, Icon, IconButton, SearchField } from '../../components'
import { cx } from '../../lib/cx'
import type { WikiNode } from '../../lib/api/types'
import { treeRows, type TreeRow } from './logic'
import { useCreatePageOnce, useMovePage } from './mutations'
import { useWikiStore } from './store'
import { TreeDragProvider } from './TreeDrag'
import { useTreeDrag, useTreeDragSource } from './treeDragState'
import { BASE_PAD, INDENT, type Drop } from './treeDrop'

type WikiTreeProps = {
  pages: WikiNode[]
  /** Открытая страница; null — открыта библиотека файлов */
  currentId: string | null
  fileTotal: number
}

/** Строка дерева, которую можно перетащить. Пока идёт поиск, дерево плоское и страницы не переносятся. */
function TreeItem({ row, current, searching, onAdd }: { row: TreeRow; current: boolean; searching: boolean; onAdd: (parentId: string) => void }) {
  const { node, depth, hasKids } = row
  const open = useWikiStore((s) => s.open)
  const toggleOpen = useWikiStore((s) => s.toggleOpen)
  const openPage = useWikiStore((s) => s.openPage)
  const drag = useTreeDrag()
  const { ref, handlers } = useTreeDragSource(node.id, searching)
  const title = node.title || 'Без названия'
  const expanded = !!open[node.id]

  // исходная страница приглушена, как у карточки; страница, на которую бросят «внутрь», подсвечена
  const style: CSSProperties = { paddingLeft: BASE_PAD + depth * INDENT }
  if (drag.id === node.id) style.opacity = 0.4
  if (drag.drop?.kind === 'into' && drag.drop.parentId === node.id) {
    style.background = 'var(--accent-soft)'
    style.boxShadow = 'inset 0 0 0 2px var(--accent)'
  }

  return (
    <div ref={ref as (el: HTMLDivElement | null) => void} className={cx('tr', current && 'on')} style={style} data-tree-id={node.id} {...handlers}>
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
      <IconButton write className="tr-add" label={`Добавить вложенную страницу в ${title}`} icon="plus" small onClick={() => onAdd(node.id)} />
    </div>
  )
}

/** Заглушка на месте падения: пунктирная строка нужной глубины (.ph, радиус как у строки дерева) */
function Placeholder({ depth, height }: { depth: number; height: number }) {
  return <div className="ph" data-ph style={{ height, marginLeft: BASE_PAD + depth * INDENT, borderRadius: 8 }} />
}

/** Строки дерева с заглушкой там, куда упадёт переносимая страница */
function Rows({ rows, currentId, searching, onAdd }: { rows: TreeRow[]; currentId: string | null; searching: boolean; onAdd: (parentId: string) => void }) {
  const { drop, h } = useTreeDrag()
  const at = (id: string, side: 'before' | 'after') => drop?.kind === 'gap' && drop.anchorId === id && drop.side === side && <Placeholder depth={drop.depth} height={h} />
  return (
    <>
      {rows.map((row) => (
        <Fragment key={row.node.id}>
          {at(row.node.id, 'before')}
          <TreeItem row={row} current={currentId === row.node.id} searching={searching} onAdd={onAdd} />
          {at(row.node.id, 'after')}
        </Fragment>
      ))}
    </>
  )
}

/** Слева: поиск, «Файлы», дерево страниц и «Новая страница» (.tree в макете) */
export function WikiTree({ pages, currentId, fileTotal }: WikiTreeProps) {
  const { q, open, view, setQuery, showFiles } = useWikiStore()
  const create = useCreatePageOnce()
  const move = useMovePage()
  const rows = treeRows(pages, open, q)

  const add = (parentId: string | null) => create(parentId, '')
  const onMove = (id: string, drop: Drop) =>
    move.mutate({ id, parentId: drop.parentId, beforeId: drop.kind === 'gap' ? drop.beforeId : null })

  return (
    <TreeDragProvider
      pages={pages}
      rows={rows}
      onMove={onMove}
      renderOverlay={(id, width) => (
        <div className="tr on" style={{ width, paddingLeft: BASE_PAD }}>
          <span className="tr-spacer" />
          <span className="tr-title">{pages.find((p) => p.id === id)?.title || 'Без названия'}</span>
        </div>
      )}
    >
      <aside className="tree" aria-label="Страницы вики" data-tree-area>
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
          <Rows rows={rows} currentId={currentId} searching={q.trim() !== ''} onAdd={add} />
          {rows.length === 0 && <div style={{ padding: '10px 8px', color: 'var(--muted)', fontSize: 13 }}>Ничего не найдено</div>}
        </div>
        <Button write onClick={() => add(null)}>
          <Icon name="plus" sm />
          Новая страница
        </Button>
      </aside>
    </TreeDragProvider>
  )
}
