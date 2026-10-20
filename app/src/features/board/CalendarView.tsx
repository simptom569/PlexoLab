import { useState } from 'react'
import { Button, IconButton } from '../../components'
import { cx } from '../../lib/cx'
import { MONF, weekdays } from '../../lib/date'
import type { TaskCard } from '../../lib/api/types'
import { toneAt } from '../../lib/tones'
import { useUi } from '../../lib/ui-store'
import { useDragSource, useDragState } from './dnd'
import { calendarCells, shiftMonth } from './logic'
import { useModel, type BoardModel } from './model'
import { describeTask } from './taskView'

/** Плашка красится в цвет первой метки задачи, без меток — в акцент */
function pillStyle(task: TaskCard, m: BoardModel) {
  const tag = describeTask(task, m).tags[0]
  const tone = tag ? toneAt(tag.tone) : null
  return { background: tone ? tone.bg : 'var(--accent-soft)', color: tone ? tone.fg : 'var(--accent)' }
}

function Pill({ task, dragging }: { task: TaskCard; dragging?: boolean }) {
  const m = useModel()
  const openTask = useUi((s) => s.openTask)
  const { ref, handlers } = useDragSource('card', task.id)
  return (
    <button
      ref={ref}
      className={cx('cal-pill', dragging && 'drag')}
      type="button"
      style={pillStyle(task, m)}
      onClick={() => openTask(task.id)}
      {...handlers}
    >
      {task.title}
    </button>
  )
}

/** Копия плашки под указателем при переносе */
export function PillOverlay({ id }: { id: string }) {
  const m = useModel()
  const task = m.onBoard.find((t) => t.id === id)
  if (!task) return null
  return (
    <span className="cal-pill" style={{ display: 'block', ...pillStyle(task, m) }}>
      {task.title}
    </span>
  )
}

export function CalendarView() {
  const m = useModel()
  const drag = useDragState()
  const weekStart = useUi((s) => s.weekStart)
  const [month, setMonth] = useState(() => ({ year: +m.today.slice(0, 4), month: +m.today.slice(5, 7) - 1 }))
  const cells = calendarCells(month.year, month.month, m.shown, m.today, weekStart)
  const dragged = drag.kind === 'card' ? m.onBoard.find((t) => t.id === drag.id) : undefined
  const shift = (delta: number) => () => setMonth(shiftMonth(month.year, month.month, delta))

  return (
    <div className="sheet">
      <div className="cal-head">
        <IconButton icon="chevronLeft" label="Предыдущий месяц" onClick={shift(-1)} />
        <strong style={{ minWidth: 140, textAlign: 'center' }}>{`${MONF[month.month]} ${month.year}`}</strong>
        <IconButton icon="chevronRight" label="Следующий месяц" onClick={shift(1)} />
        <Button onClick={() => setMonth({ year: +m.today.slice(0, 4), month: +m.today.slice(5, 7) - 1 })}>Сегодня</Button>
        <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 13 }}>Перетащи задачу на другой день, чтобы сменить срок</span>
      </div>
      <div className="cal-scroll">
        <div className="cal-inner">
          <div className="cal-grid">
            {weekdays(weekStart).map((w) => (
              <div key={w} className="cal-wd">
                {w}
              </div>
            ))}
            {cells.map((cell) => (
              <div
                key={cell.date}
                className={cx('cal-cell', !cell.inMonth && 'out', cell.today && 'today', drag.overDay === cell.date && 'over')}
                data-day={cell.date}
              >
                <span className="cal-num">{cell.num}</span>
                {cell.tasks.map((t) => (
                  <Pill key={t.id} task={t} dragging={drag.id === t.id} />
                ))}
                {drag.kind === 'card' && drag.overDay === cell.date && !!dragged && dragged.due_date !== cell.date && (
                  <div className="cal-ph">{dragged.title}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
