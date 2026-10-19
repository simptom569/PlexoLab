import { useState } from 'react'
import { Avatar, PriorityBars, Tag } from '../../components'
import { cx } from '../../lib/cx'
import { PRIORITY_LABELS } from '../../lib/domain'
import { useUi } from '../../lib/ui-store'
import { nextSort, SORTABLE, sortTasks, type Sort, type SortKey } from './logic'
import { colorVar, useModel } from './model'
import { describeTask } from './taskView'

const HEADS: Array<[SortKey | 'tags' | 'mod', string]> = [
  ['id', 'ID'],
  ['title', 'Название'],
  ['status', 'Статус'],
  ['who', 'Исполнитель'],
  ['prio', 'Приоритет'],
  ['due', 'Срок'],
  ['tags', 'Метки'],
  ['mod', 'Модуль'],
]

export function TableView() {
  const m = useModel()
  const openTask = useUi((s) => s.openTask)
  const [sort, setSort] = useState<Sort>({ key: 'id', dir: 1 })
  const rows = sortTasks(m.shown, sort, { columns: m.columns, usersById: m.usersById })

  return (
    <div className="sheet">
      <div className="sheet-scroll">
        <div className="trow thead">
          {HEADS.map(([key, label]) => {
            const on = sort.key === key
            return (
              <button
                key={key}
                className={cx('sort', on && 'on')}
                type="button"
                onClick={() => (SORTABLE as string[]).includes(key) && setSort(nextSort(sort, key as SortKey))}
              >
                {label}
                <span aria-hidden="true">{on ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</span>
              </button>
            )
          })}
        </div>
        {rows.map((t) => {
          const v = describeTask(t, m)
          const column = m.columns.find((c) => c.id === t.column_id)
          return (
            <div key={t.id} className="trow">
              <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
                {t.key}
              </span>
              <button className="row-title" type="button" onClick={() => openTask(t.id)}>
                {t.title}
              </button>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <span className="dot" style={{ background: column ? colorVar(column.color) : 'var(--muted)' }} />
                {column?.title ?? ''}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <Avatar name={v.who?.name ?? null} tone={v.who?.tone} size="sm" decorative />
                {v.who?.name ?? 'Без исполнителя'}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <PriorityBars prio={v.priority} />
                {PRIORITY_LABELS[v.priority]}
              </span>
              <span className={cx(v.due.late && 'late')} style={{ fontSize: 13 }}>
                {v.due.text}
              </span>
              <div className="row-tags">
                {v.tags.map((tag) => (
                  <Tag key={tag.id} tone={tag.tone}>
                    {tag.label}
                  </Tag>
                ))}
              </div>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{v.module?.title ?? ''}</span>
            </div>
          )
        })}
        {rows.length === 0 && (
          <div style={{ padding: '18px 16px', color: 'var(--muted)', borderTop: '1px solid var(--line)' }}>По выбранным фильтрам задач нет</div>
        )}
      </div>
    </div>
  )
}
