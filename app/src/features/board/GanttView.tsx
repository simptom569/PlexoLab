import { useState } from 'react'
import { Avatar, Button, IconButton } from '../../components'
import { mondayOf } from '../../lib/date'
import { useUi } from '../../lib/ui-store'
import { ganttLabel, ganttRows, ganttStart, ganttTicks, ganttToday } from './logic'
import { colorVar, useModel } from './model'
import { describeTask } from './taskView'

export function GanttView() {
  const m = useModel()
  const openTask = useUi((s) => s.openTask)
  const [offset, setOffset] = useState(0)
  const start = ganttStart(mondayOf(m.today), offset)
  const ticks = ganttTicks(start)
  const rows = ganttRows(m.shown, start)
  const todayLeft = ganttToday(start, m.today)

  return (
    <div className="sheet">
      <div className="cal-head">
        <IconButton icon="chevronLeft" label="Раньше" onClick={() => setOffset(offset - 1)} />
        <strong style={{ minWidth: 180, textAlign: 'center' }}>{ganttLabel(start)}</strong>
        <IconButton icon="chevronRight" label="Позже" onClick={() => setOffset(offset + 1)} />
        <Button onClick={() => setOffset(0)}>К сегодня</Button>
        <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 13 }}>Показаны задачи со сроком</span>
      </div>
      <div className="sheet-scroll">
        <div style={{ minWidth: 800 }}>
          <div className="g-row" style={{ borderTop: 0 }}>
            <div className="g-label" style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 700 }}>
              ЗАДАЧА
            </div>
            <div className="g-track" style={{ height: 34 }}>
              {ticks.map((tick) => (
                <div key={tick.label} className="g-tick" style={{ left: `${tick.left}%` }}>
                  <span>{tick.label}</span>
                </div>
              ))}
            </div>
          </div>
          {rows.map(({ task, range, left, width }) => {
            const v = describeTask(task, m)
            const column = m.columns.find((c) => c.id === task.column_id)
            const color = m.done(task) ? 'var(--ok)' : column ? colorVar(column.color) : 'var(--accent)'
            return (
              <div key={task.id} className="g-row">
                <div className="g-label">
                  <Avatar name={v.who?.name ?? null} tone={v.who?.tone} size="sm" decorative />
                  <button type="button" onClick={() => openTask(task.id)}>
                    {task.title}
                  </button>
                </div>
                <div className="g-track">
                  {ticks.map((tick) => (
                    <div key={tick.label} className="g-tick" style={{ left: `${tick.left}%` }} />
                  ))}
                  {todayLeft !== null && <div className="g-today" style={{ left: `${todayLeft}%` }} />}
                  <button
                    className="g-bar"
                    type="button"
                    aria-label={`${task.title}: ${range}`}
                    style={{ left: `${left}%`, width: `${width}%`, background: color }}
                    onClick={() => openTask(task.id)}
                  >
                    {range}
                  </button>
                </div>
              </div>
            )
          })}
          {rows.length === 0 && (
            <div style={{ padding: '18px 16px', color: 'var(--muted)', borderTop: '1px solid var(--line)' }}>Нет задач со сроком в этом диапазоне</div>
          )}
        </div>
      </div>
    </div>
  )
}
