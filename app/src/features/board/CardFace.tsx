import type { Ref } from 'react'
import { Avatar, Icon, PriorityBars, ProgressBar, Pill, Tag } from '../../components'
import { cx } from '../../lib/cx'
import type { TaskCard } from '../../lib/api/types'
import { useDragSource } from './dnd'
import { useModel } from './model'
import { describeTask } from './taskView'
import { useUi } from '../../lib/ui-store'

type CardProps = {
  task: TaskCard
  /** Источник переноса приглушён (.drag) */
  dragging?: boolean
  /** Копия под указателем: без обработчиков */
  overlay?: boolean
}

/** Карточка задачи на доске (article.card) */
export function CardFace({ task, dragging, overlay, nodeRef, handlers }: CardProps & { nodeRef?: Ref<HTMLElement>; handlers?: object }) {
  const m = useModel()
  const display = useUi((s) => s.display)
  const openTask = useUi((s) => s.openTask)
  const v = describeTask(task, m)
  const open = overlay ? undefined : () => openTask(task.id)

  return (
    <article ref={nodeRef} className={cx('card', dragging && 'drag')} data-card-id={overlay ? undefined : task.id} onClick={open} {...handlers}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
          {task.key}
        </span>
        {display.module && v.module && <Pill style={{ padding: '1px 8px' }}>{v.module.title}</Pill>}
        {display.prio && <PriorityBars prio={v.priority} labelled style={{ marginLeft: 'auto' }} />}
      </div>
      {display.tags && v.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {v.tags.map((tag) => (
            <Tag key={tag.id} tone={tag.tone}>
              {tag.label}
            </Tag>
          ))}
        </div>
      )}
      <button className="card-title" type="button" onClick={open}>
        {task.title}
      </button>
      {display.subs && task.subtasks_total > 0 && (
        <div className="meta">
          <Icon name="subtasks" sm />
          <span>{`${task.subtasks_done}/${task.subtasks_total}`}</span>
          <ProgressBar small pct={Math.round((task.subtasks_done / task.subtasks_total) * 100)} style={{ flex: 1 }} />
        </div>
      )}
      <div className="meta">
        {display.pr && task.pr && (
          <span className="i">
            <Icon name="branch" sm />
            {task.pr}
          </span>
        )}
        {display.due && task.due_date && (
          <span className={cx('i', v.due.late && 'late')}>
            <Icon name="calendar" sm />
            {v.due.text}
          </span>
        )}
        {display.who && <Avatar name={v.who?.name ?? null} tone={v.who?.tone} style={{ marginLeft: 'auto' }} />}
      </div>
    </article>
  )
}

/** Карточка, которую можно перетащить */
export function DraggableCard({ task, dragging }: CardProps) {
  const { ref, handlers } = useDragSource('card', task.id)
  return <CardFace task={task} dragging={dragging} nodeRef={ref} handlers={handlers} />
}
