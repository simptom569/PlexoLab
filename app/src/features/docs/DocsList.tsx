import { Fragment, type Ref } from 'react'
import { Avatar, Button, Chip, EmptyState, Icon, SearchField } from '../../components'
import { useDocSearch, useDocs, useUsers } from '../../lib/api/queries'
import type { DocSummary, User } from '../../lib/api/types'
import { cx } from '../../lib/cx'
import { useDebounced } from '../../lib/useDebounced'
import { DragProvider } from '../board/DragProvider'
import { END, nextOf, useDragSource, useDragState, type DragState } from '../board/dnd'
import { fileDate } from '../wiki/logic'
import { beforeFor, docTitle, hasThumb, modeLabel, objectsLabel, snippetText, starLabel, thumbBoxes } from './logic'
import { useCreateDocOnce, useMoveDoc, useStarDoc } from './mutations'
import { useDocsStore } from './store'

/** Пауза после последней буквы поиска, прежде чем спросить сервер (текст документов в список не приходит) */
const SEARCH_DELAY_MS = 250

type FaceProps = {
  doc: DocSummary
  author: User | undefined
  /** Источник переноса приглушён */
  dragging?: boolean
  /** Копия под указателем: без обработчиков и меток */
  overlay?: boolean
  nodeRef?: Ref<HTMLElement>
  handlers?: object
}

/** Карточка документа (.dcard) */
function CardFace({ doc, author, dragging, overlay, nodeRef, handlers }: FaceProps) {
  const star = useStarDoc()
  const open = useDocsStore((s) => s.openDoc)
  const label = starLabel(doc.starred)
  return (
    <div
      ref={nodeRef as Ref<HTMLDivElement>}
      className="dcard"
      style={dragging ? { opacity: 0.4 } : undefined}
      data-doc-id={overlay ? undefined : doc.id}
      {...handlers}
    >
      <button className="dcard-open" type="button" onClick={overlay ? undefined : () => open(doc.id)}>
        <span className="dcard-title">{docTitle(doc.title)}</span>
        {hasThumb(doc) ? (
          <span className="dthumb" aria-hidden="true">
            {thumbBoxes(doc).map((b, i) => (
              <i key={i} style={{ left: b.l, top: b.t, width: b.w, height: b.h, background: b.bg, borderColor: b.bd }} />
            ))}
          </span>
        ) : (
          <span className="dcard-snip">{snippetText(doc)}</span>
        )}
        <span className="dmeta">
          <Avatar size="sm" name={author?.name ?? null} tone={author?.tone} emptyLabel="Автор неизвестен" />
          <span>{fileDate(doc.updated_at)}</span>
          <span aria-hidden="true">·</span>
          <span>{modeLabel(doc.mode)}</span>
          <span className="dm-obj">{objectsLabel(doc.object_count)}</span>
        </span>
      </button>
      <button
        className={cx('icon-btn', 'dstar', doc.starred && 'on')}
        type="button"
        aria-label={label}
        title={label}
        onClick={overlay ? undefined : () => star.mutate({ id: doc.id, starred: !doc.starred })}
      >
        <Icon name="star" />
      </button>
    </div>
  )
}

function DraggableCard(props: FaceProps) {
  const { ref, handlers } = useDragSource('doc', props.doc.id)
  return <CardFace {...props} nodeRef={ref} handlers={handlers} />
}

/** Заглушка на месте падения: пунктирная ячейка размера переносимой карточки, как у задач (.ph) */
const Placeholder = ({ drag }: { drag: DragState }) => <div className="ph ph-col" data-ph style={{ height: drag.h }} />

/** Сетка карточек; заглушка стоит перед карточкой, над которой указатель, или в конце */
function Grid({ docs, authors }: { docs: DocSummary[]; authors: Map<string, User> }) {
  const drag = useDragState()
  // у самой переносимой карточки и у следующей за ней заглушка не нужна: это то же место
  const dr = drag.kind === 'doc' ? drag.id : null
  const drNext = nextOf(docs, dr)
  const phAt = (id: string) => !!dr && drag.overDoc === id && id !== dr && id !== drNext

  return (
    <div className="dgrid" data-docs-grid>
      {docs.map((d) => (
        <Fragment key={d.id}>
          {phAt(d.id) && <Placeholder drag={drag} />}
          <DraggableCard doc={d} author={d.created_by ? authors.get(d.created_by) : undefined} dragging={dr === d.id} />
        </Fragment>
      ))}
      {phAt(END) && <Placeholder drag={drag} />}
    </div>
  )
}

/** Список документов: заголовок, поиск, «Избранные», карточки, которые можно переставлять */
export function DocsList() {
  const { q, starOnly, setQuery, toggleStarOnly } = useDocsStore()
  const createDoc = useCreateDocOnce()
  const move = useMoveDoc()
  const users = useUsers().data
  const all = useDocs()

  // что искать: пустой запрос сразу показывает все документы, непустой идёт на сервер с паузой
  const typed = q.trim()
  const debounced = useDebounced(typed, SEARCH_DELAY_MS)
  const query = typed === '' ? '' : debounced
  const search = useDocSearch(query)

  const authors = new Map((users ?? []).map((u) => [u.id, u]))

  if (all.isPending) return <EmptyState>Загружаю документы…</EmptyState>
  if (all.isError) {
    return (
      <EmptyState>
        Не удалось загрузить документы
        <div style={{ marginTop: 12 }}>
          <Button onClick={() => void all.refetch()}>Повторить</Button>
        </div>
      </EmptyState>
    )
  }

  const source = (query ? search.data : undefined) ?? all.data
  const docs = source.filter((d) => !starOnly || d.starred)

  // Бросок карточки: порядок общий для команды. Возврат на то же место ничего не делает.
  const onDrop = (s: DragState) => {
    if (s.kind !== 'doc' || !s.id) return
    const over = s.overDoc ?? END
    const before = beforeFor(
      all.data.map((d) => d.id),
      docs.map((d) => d.id),
      s.id,
      over === END ? null : over,
    )
    if (before !== undefined) move.mutate({ id: s.id, beforeId: before })
  }

  const renderOverlay = (_kind: string, id: string) => {
    const doc = docs.find((d) => d.id === id)
    return doc ? <CardFace doc={doc} author={doc.created_by ? authors.get(doc.created_by) : undefined} overlay /> : null
  }

  return (
    <DragProvider onDrop={onDrop} renderOverlay={renderOverlay}>
      <header className="head">
        <div className="head-l">
          <h1 className="h1">Документы</h1>
          <p className="sub">Заметки, планы и схемы. Каждый документ открывается как страница или как холст, а текст в обоих режимах один и тот же.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button onClick={() => createDoc('edge')}>Новый холст</Button>
          <Button variant="primary" onClick={() => createDoc('page')}>
            <Icon name="plus" />
            Новый документ
          </Button>
        </div>
      </header>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <SearchField label="Поиск по документам" placeholder="Поиск документов" value={q} onChange={setQuery} />
        <Chip toggle on={starOnly} onClick={toggleStarOnly}>
          Избранные
        </Chip>
      </div>
      <Grid docs={docs} authors={authors} />
      {docs.length === 0 && <EmptyState>Документов не найдено</EmptyState>}
    </DragProvider>
  )
}
