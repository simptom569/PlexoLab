import { useState, type Ref } from 'react'
import { Avatar, Button, Icon, Input, PageHead, PriorityBars, Tag } from '../../components'
import { cx } from '../../lib/cx'
import type { TaskCard } from '../../lib/api/types'
import { useUi } from '../../lib/ui-store'
import { BoardLoader } from '../board/BoardLoader'
import { DragProvider } from '../board/DragProvider'
import { END, nextOf, useDragSource, useDragState, type DragState } from '../board/dnd'
import { colorVar, useModel, useMutations } from '../board/model'
import { describeTask } from '../board/taskView'

type RowProps = {
  task: TaskCard
  /** Источник переноса приглушён (.drag) */
  dragging?: boolean
  /** Копия под указателем: без обработчиков */
  overlay?: boolean
}

/** Строка бэклога (.brow) */
function RowFace({ task, dragging, overlay, nodeRef, handlers }: RowProps & { nodeRef?: Ref<HTMLElement>; handlers?: object }) {
  const m = useModel()
  const { moveTask } = useMutations()
  const openTask = useUi((s) => s.openTask)
  const v = describeTask(task, m)
  const first = m.columns[0]

  return (
    <div ref={nodeRef as Ref<HTMLDivElement>} className={cx('brow', dragging && 'drag')} data-row-id={overlay ? undefined : task.id} {...handlers}>
      <span className="grip" aria-hidden="true">
        <Icon name="grip" sm />
      </span>
      <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
        {task.key}
      </span>
      <button className="row-title" type="button" onClick={overlay ? undefined : () => openTask(task.id)}>
        {task.title}
      </button>
      <div className="row-tags">
        {v.tags.map((tag) => (
          <Tag key={tag.id} tone={tag.tone}>
            {tag.label}
          </Tag>
        ))}
      </div>
      <span style={{ fontSize: 13, color: 'var(--muted)' }}>{v.module?.title ?? ''}</span>
      <Avatar name={v.who?.name ?? null} tone={v.who?.tone} />
      <PriorityBars prio={v.priority} labelled />
      <Button
        write
        onClick={
          overlay || !first
            ? undefined
            : () => moveTask.mutate({ id: task.id, columnId: first.id, beforeId: null })
        }
      >
        На доску
      </Button>
    </div>
  )
}

function DraggableRow(props: RowProps) {
  const { ref, handlers } = useDragSource('row', props.task.id)
  return <RowFace {...props} nodeRef={ref} handlers={handlers} />
}

/** Заглушка на месте падения: во всю ширину строки (.brow-ph) */
const Placeholder = ({ drag }: { drag: DragState }) => <div className="brow-ph" data-ph style={{ height: drag.h }} />

function Rows() {
  const m = useModel()
  const drag = useDragState()

  // заглушка: перед строкой id или в конце списка (END); у самой переносимой строки и следующей за ней не нужна
  const dr = drag.kind === 'row' ? drag.id : null
  const drNext = nextOf(m.backlog, dr)
  const phAt = (id: string) => !!dr && drag.overRow === id && id !== dr && id !== drNext

  return (
    <div className="sheet">
      <div className="sheet-scroll" data-backlog>
        {m.backlog.map((t) => (
          <div key={t.id} className="bwrap" style={{ display: 'contents' }}>
            {phAt(t.id) && <Placeholder drag={drag} />}
            <DraggableRow task={t} dragging={dr === t.id} />
          </div>
        ))}
        {phAt(END) && <Placeholder drag={drag} />}
        {m.backlog.length === 0 && (
          <div style={{ padding: '22px 16px', color: 'var(--muted)', textAlign: 'center' }}>Бэклог пуст. Все задачи уже на доске</div>
        )}
      </div>
    </div>
  )
}

function QuickAdd() {
  const { createTask } = useMutations()
  const [draft, setDraft] = useState('')
  const add = () => {
    const title = draft.trim()
    if (!title) return
    createTask.mutate({ columnId: null, title })
    setDraft('')
  }
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Input
        style={{ flex: '1 1 320px', maxWidth: 560 }}
        placeholder="Новая задача в бэклог, затем Enter"
        aria-label="Новая задача в бэклог"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add()
        }}
      />
      <Button write variant="primary" onClick={add}>
        Добавить
      </Button>
    </div>
  )
}

function BacklogScreen() {
  const m = useModel()
  const { moveTask } = useMutations()

  // Бросок строки: порядок в бэклоге меняется, возврат на то же место ничего не делает
  const onDrop = (s: DragState) => {
    if (s.kind !== 'row' || !s.id) return
    const next = nextOf(m.backlog, s.id)
    const before = s.overRow ?? END
    if (before === s.id || before === next) return
    moveTask.mutate({ id: s.id, columnId: null, beforeId: before === END ? null : before })
  }

  const renderOverlay = (_kind: string, id: string) => {
    const task = m.backlog.find((t) => t.id === id)
    return task ? <RowFace task={task} overlay /> : null
  }

  return (
    <DragProvider onDrop={onDrop} renderOverlay={renderOverlay}>
      <PageHead
        projectName={m.board.project.name}
        projectColor={colorVar(m.board.project.color)}
        title="Бэклог"
        subtitle="Задачи, которых пока нет на доске. Перетащи строку, чтобы изменить порядок, или отправь задачу на доску кнопкой."
      />
      <QuickAdd />
      <Rows />
    </DragProvider>
  )
}

/** Страница «Бэклог» выбранного проекта: задачи без колонки */
export function BacklogPage({ projectId }: { projectId: string }) {
  return (
    <BoardLoader projectId={projectId} what="бэклог">
      <BacklogScreen />
    </BoardLoader>
  )
}
