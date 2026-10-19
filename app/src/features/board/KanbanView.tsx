import { Fragment, useEffect, useRef, useState, type Ref, type RefObject } from 'react'
import { create } from 'zustand'
import { Anchor, Button, Count, Icon, IconButton, MenuItem, Popover } from '../../components'
import { cx } from '../../lib/cx'
import type { Column, TaskCard } from '../../lib/api/types'
import { useUi } from '../../lib/ui-store'
import { CardFace, DraggableCard } from './CardFace'
import { END, nextOf, useDragSource, useDragState, type DragState } from './dnd'
import { COLUMN_COLORS, colorVar, useModel, useMutations } from './model'

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

/** Какая колонка сейчас переименовывается (editCol в макете). Нужна и меню, и колонке: они в разных ветках дерева. */
const useColumnEdit = create<{ id: string | null; start: (id: string) => void; stop: () => void }>()((set) => ({
  id: null,
  start: (id) => set({ id }),
  stop: () => set({ id: null }),
}))

/** Поле ввода, которое получает фокус при появлении (data-autofocus в макете) */
function useFocusOnMount<T extends HTMLInputElement>(select = false): RefObject<T | null> {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    ref.current?.focus()
    if (select) ref.current?.select()
  }, [select])
  return ref
}

function ColumnTitleInput({ column, onDone }: { column: Column; onDone: () => void }) {
  const { updateColumn } = useMutations()
  const [draft, setDraft] = useState(column.title)
  const ref = useFocusOnMount<HTMLInputElement>(true)
  const commit = () => {
    const title = draft.trim()
    if (title && title !== column.title) updateColumn.mutate({ id: column.id, patch: { title } })
    onDone()
  }
  return (
    <input
      ref={ref}
      className="col-input"
      aria-label="Название колонки"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') commit()
      }}
      onBlur={commit}
    />
  )
}

function QuickAdd({ columnId, onClose }: { columnId: string; onClose: () => void }) {
  const { createTask } = useMutations()
  const [title, setTitle] = useState('')
  const ref = useFocusOnMount<HTMLInputElement>()
  const add = (keepOpen: boolean) => {
    const value = title.trim()
    if (value) createTask.mutate({ columnId, title: value })
    setTitle('')
    if (keepOpen) ref.current?.focus()
    else onClose()
  }
  return (
    <div className="card" style={{ cursor: 'default' }}>
      <input
        ref={ref}
        className="quick"
        placeholder="Название задачи"
        aria-label="Название новой задачи"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (title.trim()) add(true)
          } else if (e.key === 'Escape') onClose()
        }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <Button onClick={() => add(false)}>Добавить</Button>
        <Button variant="ghost" onClick={onClose}>
          Отмена
        </Button>
      </div>
    </div>
  )
}

function ColumnMenu({ column, others, totalIn }: { column: Column; others: Column[]; totalIn: number }) {
  const { updateColumn, deleteColumn } = useMutations()
  const closeMenus = useUi((s) => s.closeMenus)
  const other = others[0]
  return (
    <Popover small right role="menu">
      <MenuItem
        onClick={() => {
          closeMenus()
          useColumnEdit.getState().start(column.id)
        }}
      >
        Переименовать
      </MenuItem>
      <MenuItem
        onClick={() => {
          updateColumn.mutate({ id: column.id, patch: { is_done: !column.is_done } })
          closeMenus()
        }}
      >
        <span>{column.is_done ? 'Не считать колонкой «Готово»' : 'Считать колонкой «Готово»'}</span>
      </MenuItem>
      <div className="swatches" role="group" aria-label="Цвет колонки">
        {COLUMN_COLORS.map((token) => (
          <button
            key={token}
            className="sw-btn"
            type="button"
            aria-label="Цвет колонки"
            style={{ background: colorVar(token) }}
            onClick={() => {
              updateColumn.mutate({ id: column.id, patch: { color: token } })
              closeMenus()
            }}
          />
        ))}
      </div>
      <MenuItem
        danger
        onClick={() => {
          if (!other) return
          deleteColumn.mutate({ id: column.id, moveTo: other.id })
          closeMenus()
        }}
      >
        <span>
          Удалить колонку
          <small>{other ? `Задачи (${totalIn}) переедут в «${other.title}»` : 'Нельзя удалить единственную колонку'}</small>
        </span>
      </MenuItem>
    </Popover>
  )
}

type ColumnProps = {
  column: Column
  items: TaskCard[]
  totalIn: number
  others: Column[]
  drag: DragState
  adding: boolean
  onAdd: (open: boolean) => void
}

function ColumnView({ column, items, totalIn, others, drag, adding, onAdd, nodeRef, handlers }: ColumnProps & { nodeRef?: Ref<HTMLElement>; handlers?: object }) {
  const menu = useUi((s) => s.menu)
  const toggleMenu = useUi((s) => s.toggleMenu)
  const editing = useColumnEdit((s) => s.id === column.id)
  const stopEdit = useColumnEdit((s) => s.stop)
  const menuKey = `col:${column.id}`
  const menuOpen = menu === menuKey

  // заглушка карточки: перед карточкой id или в конец (END); у самой переносимой и следующей за ней не нужна
  const dc = drag.kind === 'card' ? drag.id : null
  const dcNext = nextOf(items, dc)
  const phAt = (id: string) => !!dc && drag.overCol === column.id && drag.overCard === id && id !== dc && id !== dcNext

  return (
    <section ref={nodeRef} className={cx('col', drag.overCol === column.id && !!dc && 'over', drag.kind === 'col' && drag.id === column.id && 'drag')} aria-label={column.title} data-col-id={column.id}>
      <div className="col-head" {...(editing ? {} : handlers)}>
        <span className="grip" aria-hidden="true">
          <Icon name="grip" sm />
        </span>
        <span className="dot" style={{ background: colorVar(column.color) }} />
        {editing ? <ColumnTitleInput column={column} onDone={stopEdit} /> : <h2>{column.title}</h2>}
        <Count surface>{items.length}</Count>
        <IconButton icon="plus" label={`Добавить задачу в колонку ${column.title}`} onClick={() => onAdd(true)} onPointerDown={stop} />
        <Anchor>
          <IconButton
            icon="dots"
            label={`Меню колонки ${column.title}`}
            aria-expanded={menuOpen}
            onClick={() => toggleMenu(menuKey)}
            onPointerDown={stop}
          />
          {menuOpen && <ColumnMenu column={column} others={others} totalIn={totalIn} />}
        </Anchor>
      </div>

      <div className="col-body">
        {items.map((t) => (
          <Fragment key={t.id}>
            {phAt(t.id) && <div className="ph" data-ph style={{ height: drag.h }} />}
            <DraggableCard task={t} dragging={dc === t.id} />
          </Fragment>
        ))}
        {phAt(END) && <div className="ph" data-ph style={{ height: drag.h }} />}

        {adding && <QuickAdd columnId={column.id} onClose={() => onAdd(false)} />}

        {items.length === 0 && !adding && !phAt(END) && <div className="drop-hint">Нет задач. Перетащи сюда карточку</div>}
      </div>
    </section>
  )
}

function DraggableColumn(props: ColumnProps) {
  const { ref, handlers } = useDragSource('col', props.column.id)
  return <ColumnView {...props} nodeRef={ref} handlers={handlers} />
}

/** Копия колонки под указателем при переносе */
export function ColumnOverlay({ id }: { id: string }) {
  const m = useModel()
  const column = m.columns.find((c) => c.id === id)
  if (!column) return null
  const items = m.shown.filter((t) => t.column_id === id)
  return (
    <div style={{ display: 'flex' }}>
      <section className="col" aria-hidden="true">
        <div className="col-head">
          <span className="grip">
            <Icon name="grip" sm />
          </span>
          <span className="dot" style={{ background: colorVar(column.color) }} />
          <h2>{column.title}</h2>
          <Count surface>{items.length}</Count>
        </div>
        <div className="col-body">
          {items.map((t) => (
            <CardFace key={t.id} task={t} overlay />
          ))}
        </div>
      </section>
    </div>
  )
}

function NewColumnForm({ onClose }: { onClose: () => void }) {
  const { createColumn } = useMutations()
  const [title, setTitle] = useState('')
  const ref = useFocusOnMount<HTMLInputElement>()
  const add = (keepOpen: boolean) => {
    const value = title.trim()
    if (value) createColumn.mutate({ title: value })
    setTitle('')
    if (keepOpen && value) ref.current?.focus()
    else if (!keepOpen) onClose()
  }
  return (
    <>
      <input
        ref={ref}
        className="quick"
        placeholder="Название колонки"
        aria-label="Название новой колонки"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (title.trim()) add(true)
          } else if (e.key === 'Escape') onClose()
        }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <Button onClick={() => add(false)}>Добавить</Button>
        <Button variant="ghost" onClick={onClose}>
          Отмена
        </Button>
      </div>
    </>
  )
}

function NewColumn() {
  const [open, setOpen] = useState(false)
  return (
    <div className="col col-new" data-new-col>
      {open ? (
        <NewColumnForm onClose={() => setOpen(false)} />
      ) : (
        <button className="add-col" type="button" onClick={() => setOpen(true)}>
          <Icon name="plus" />
          Добавить колонку
        </button>
      )}
    </div>
  )
}

export function KanbanView() {
  const m = useModel()
  const drag = useDragState()
  const [adding, setAdding] = useState<string | null>(null)

  // заглушка колонки: перед колонкой id или в конец (END)
  const dk = drag.kind === 'col' ? drag.id : null
  const dkNext = nextOf(m.columns, dk)
  const phCol = (id: string) => !!dk && drag.overSlot === id && id !== dk && id !== dkNext
  const phEndCol = !!dk && drag.overSlot === END && dkNext !== END

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', minWidth: 'min-content' }}>
        {m.columns.map((column) => (
          <Fragment key={column.id}>
            {phCol(column.id) && <div className="ph ph-col" data-ph style={{ width: drag.w, height: drag.h }} />}
            <DraggableColumn
              column={column}
              items={m.shown.filter((t) => t.column_id === column.id)}
              totalIn={m.onBoard.filter((t) => t.column_id === column.id).length}
              others={m.columns.filter((c) => c.id !== column.id)}
              drag={drag}
              adding={adding === column.id}
              onAdd={(open) => setAdding(open ? column.id : null)}
            />
          </Fragment>
        ))}
        {phEndCol && <div className="ph ph-col" data-ph style={{ width: drag.w, height: drag.h }} />}
        <NewColumn />
      </div>
    </div>
  )
}
