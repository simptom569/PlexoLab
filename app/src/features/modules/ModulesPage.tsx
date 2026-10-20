import { useState } from 'react'
import { Avatar, Button, DateField, EmptyState, Input, PageHead, Panel, ProgressBar, TitleInput } from '../../components'
import type { Module, TaskCard, UpdateModule } from '../../lib/api/types'
import { MODULE_STATUS_LABELS, NEXT_STATUS, type WorkStatus } from '../../lib/domain'
import { percent, tasksText } from '../../lib/progress'
import { useUi } from '../../lib/ui-store'
import { useDraftField } from '../../lib/useDraft'
import { BoardLoader } from '../board/BoardLoader'
import { colorVar, useModel, useMutations } from '../board/model'

/** Сколько задач показывает карточка модуля, остальные — «и ещё N» */
const SHOWN_TASKS = 5

function MiniTask({ task }: { task: TaskCard }) {
  const m = useModel()
  const openTask = useUi((s) => s.openTask)
  const who = task.assignee_id ? m.usersById.get(task.assignee_id) : undefined
  const column = m.columns.find((c) => c.id === task.column_id)
  return (
    <div className="mini-task">
      <span className="dot" style={{ background: column ? colorVar(column.color) : 'var(--line-strong)' }} />
      <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
        {task.key}
      </span>
      <button className="row-title" type="button" onClick={() => openTask(task.id)}>
        {task.title}
      </button>
      <Avatar name={who?.name ?? null} tone={who?.tone} size="sm" />
    </div>
  )
}

function ModuleCard({ module }: { module: Module }) {
  const m = useModel()
  const { updateModule, deleteModule } = useMutations()
  const showOnBoard = useUi((s) => s.showModuleOnBoard)
  const confirm = useUi((s) => s.confirm)
  const setConfirm = useUi((s) => s.setConfirm)

  const update = (patch: UpdateModule) => updateModule.mutate({ id: module.id, patch })
  const title = useDraftField(module.title, (next) => update({ title: next }))
  const note = useDraftField(module.note, (next) => update({ note: next }), { allowEmpty: true })

  const lead = module.lead_id ? m.usersById.get(module.lead_id) : undefined
  const leadIndex = m.users.findIndex((u) => u.id === module.lead_id)
  const cycleLead = () => {
    const next = m.users[(leadIndex + 1) % m.users.length]
    if (next) update({ lead_id: next.id })
  }

  const status = module.status as WorkStatus
  const pct = percent(module.tasks_done, module.tasks_total)
  const tasks = m.board.tasks.filter((t) => t.module_id === module.id).sort((a, b) => a.number - b.number)

  const key = `mod:${module.id}`
  const remove = () => {
    if (confirm === key) {
      setConfirm(null)
      deleteModule.mutate({ id: module.id })
    } else setConfirm(key)
  }

  return (
    <Panel>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <TitleInput aria-label="Название модуля" {...title} />
        <button className={`pill-btn ${status}`} type="button" title="Сменить статус" onClick={() => update({ status: NEXT_STATUS[status] })}>
          {MODULE_STATUS_LABELS[status]}
        </button>
      </div>
      <input className="note-inp" aria-label="Описание модуля" placeholder="Короткое описание" {...note} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: 'var(--muted)' }}>{`${tasksText(module.tasks_done, module.tasks_total)} готово`}</span>
          <strong>{`${pct}%`}</strong>
        </div>
        <ProgressBar ok={pct === 100} pct={pct} />
      </div>
      <div className="f-val" style={{ gap: 10 }}>
        <button className="opt" type="button" title="Сменить ответственного" onClick={cycleLead}>
          <Avatar name={lead?.name ?? null} tone={lead?.tone} size="sm" decorative />
          {lead?.name ?? 'Не назначен'}
        </button>
        <label style={{ fontSize: 12, color: 'var(--muted)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          с
          <DateField
            clearable
            style={{ padding: '4px 8px', fontSize: 12 }}
            value={module.date_from ?? ''}
            onChange={(v) => update({ date_from: v || null })}
          />
        </label>
        <label style={{ fontSize: 12, color: 'var(--muted)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          по
          <DateField
            clearable
            style={{ padding: '4px 8px', fontSize: 12 }}
            value={module.date_to ?? ''}
            onChange={(v) => update({ date_to: v || null })}
          />
        </label>
      </div>
      <div>
        {tasks.slice(0, SHOWN_TASKS).map((t) => (
          <MiniTask key={t.id} task={t} />
        ))}
        {tasks.length === 0 && <div className="drop-hint">Задач пока нет. Модуль выбирается в панели задачи</div>}
        {tasks.length > SHOWN_TASKS && (
          <div style={{ fontSize: 12, color: 'var(--muted)', paddingTop: 6 }}>{`и ещё ${tasks.length - SHOWN_TASKS}`}</div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 'auto' }}>
        <Button onClick={() => showOnBoard(module.id)}>Показать на доске</Button>
        <Button variant="ghost" onClick={remove}>
          {confirm === key ? 'Точно удалить?' : 'Удалить'}
        </Button>
      </div>
    </Panel>
  )
}

function NewModule() {
  const { createModule } = useMutations()
  const [draft, setDraft] = useState('')
  const add = () => {
    const title = draft.trim()
    if (!title) return
    createModule.mutate({ title })
    setDraft('')
  }
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Input
        style={{ width: 240 }}
        placeholder="Название нового модуля"
        aria-label="Название нового модуля"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add()
        }}
      />
      <Button variant="primary" onClick={add}>
        Модуль
      </Button>
    </div>
  )
}

function ModulesScreen() {
  const m = useModel()
  const modules = m.board.modules
  return (
    <>
      <PageHead
        projectName={m.board.project.name}
        projectColor={colorVar(m.board.project.color)}
        title="Модули"
        subtitle="Темы, которые объединяют задачи. Прогресс считается автоматически по задачам, у которых выбран модуль."
      >
        <NewModule />
      </PageHead>
      <div className="cards-grid">
        {modules.map((module) => (
          <ModuleCard key={module.id} module={module} />
        ))}
      </div>
      {modules.length === 0 && <EmptyState>В этом проекте модулей пока нет</EmptyState>}
    </>
  )
}

/** Страница «Модули» выбранного проекта */
export function ModulesPage({ projectId }: { projectId: string }) {
  return (
    <BoardLoader projectId={projectId} what="модули">
      <ModulesScreen />
    </BoardLoader>
  )
}
