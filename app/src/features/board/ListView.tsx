import { Avatar, Count, PriorityBars, Tag, Tick } from '../../components'
import { cx } from '../../lib/cx'
import type { TaskCard } from '../../lib/api/types'
import { useUi } from '../../lib/ui-store'
import { colorVar, useModel } from './model'
import { describeTask } from './taskView'
import { useToggleDone } from './useToggleDone'

function Row({ task }: { task: TaskCard }) {
  const m = useModel()
  const openTask = useUi((s) => s.openTask)
  const toggleDone = useToggleDone()
  const v = describeTask(task, m)
  return (
    <div className="row">
      <Tick write done={m.done(task)} label={`Переключить выполнение ${task.key}`} onClick={() => toggleDone(task)} />
      <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
        {task.key}
      </span>
      <button className="row-title" type="button" onClick={() => openTask(task.id)}>
        {task.title}
      </button>
      <div className="row-tags">
        {v.tags.map((tag) => (
          <Tag key={tag.id} tone={tag.tone}>
            {tag.label}
          </Tag>
        ))}
      </div>
      <Avatar name={v.who?.name ?? null} tone={v.who?.tone} />
      <span className={cx(v.due.late && 'late')} style={{ fontSize: 13 }}>
        {v.due.text}
      </span>
      <PriorityBars prio={v.priority} labelled />
    </div>
  )
}

export function ListView() {
  const m = useModel()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {m.columns.map((column) => {
        const rows = m.shown.filter((t) => t.column_id === column.id)
        return (
          <section key={column.id} className="sheet">
            <div className="list-head">
              <span className="dot" style={{ background: colorVar(column.color) }} />
              <span>{column.title}</span>
              <Count surface>{rows.length}</Count>
            </div>
            <div className="sheet-scroll">
              {rows.map((t) => (
                <Row key={t.id} task={t} />
              ))}
              {rows.length === 0 && (
                <div style={{ padding: '14px 16px', color: 'var(--muted)', fontSize: 13, borderTop: '1px solid var(--line)' }}>Нет задач</div>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
