import { useState } from 'react'
import { Avatar, Button, DateField, EmptyState, Input, PageHead, Panel, PersonSelect, ProgressBar, TitleInput } from '../../components'
import type { Module, TaskCard, UpdateModule } from '../../lib/api/types'
import { MODULE_STATUS_LABELS, NEXT_STATUS, type WorkStatus } from '../../lib/domain'
import { isValidKey, KEY_RULE, normalizeKey } from '../../lib/project-dialogs'
import { percent, tasksText } from '../../lib/progress'
import { moduleKeyChangeCount, moduleKeyChangeDetail, projectPrefix } from '../../lib/task-ids'
import { useReadOnly } from '../../lib/link'
import { useUi } from '../../lib/ui-store'
import { useDraft, useDraftField } from '../../lib/useDraft'
import { BoardLoader } from '../board/BoardLoader'
import { colorVar, useModel, useMutations } from '../board/model'
import { errorText, setModuleKey } from '../projects/api'
import { IdChangeDialog } from '../projects/IdChangeDialog'
import { Problem } from '../projects/parts'

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
  const readOnly = useReadOnly()
  const showOnBoard = useUi((s) => s.showModuleOnBoard)
  const confirm = useUi((s) => s.confirm)
  const setConfirm = useUi((s) => s.setConfirm)

  const update = (patch: UpdateModule) => updateModule.mutate({ id: module.id, patch })
  const title = useDraftField(module.title, (next) => update({ title: next }))
  const note = useDraftField(module.note, (next) => update({ note: next }), { allowEmpty: true })

  const status = module.status as WorkStatus
  const pct = percent(module.tasks_done, module.tasks_total)
  const tasks = m.board.tasks.filter((t) => t.module_id === module.id).sort((a, b) => a.number - b.number)

  // ключ задач: сохраняется по Enter или уходу из поля; если у задач модуля от этого меняются id, сначала спрашиваем
  const [keyDraft, setKeyDraft] = useDraft(module.key ?? '')
  const [keyProblem, setKeyProblem] = useState<string | null>(null)
  const [keyAsk, setKeyAsk] = useState<{ next: string | null; count: number } | null>(null)
  const projectId = m.board.project.id
  const saveKey = async (next: string | null) => {
    setKeyAsk(null)
    setKeyProblem(null)
    try {
      await setModuleKey(projectId, module.id, next)
    } catch (e) {
      setKeyProblem(errorText(e))
      setKeyDraft(module.key ?? '')
    }
  }
  const commitKey = () => {
    const next = normalizeKey(keyDraft)
    setKeyDraft(next)
    if (next === (module.key ?? '')) return
    if (!isValidKey(next)) {
      setKeyProblem(KEY_RULE)
      setKeyDraft(module.key ?? '')
      return
    }
    const count = moduleKeyChangeCount(m.board, module.id)
    if (count > 0) setKeyAsk({ next: next || null, count })
    else void saveKey(next || null)
  }

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
        <button className={`pill-btn ${status}`} type="button" title="Сменить статус" disabled={readOnly} onClick={() => update({ status: NEXT_STATUS[status] })}>
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
        {/* ответственным назначают участников проекта; тот, кто уже назначен и вышел из проекта, остаётся в списке */}
        <PersonSelect
          value={module.lead_id ?? null}
          people={m.pickable(module.lead_id)}
          noneLabel="Не назначен"
          label="Ответственный"
          title="Сменить ответственного"
          onChange={(id) => update({ lead_id: id })}
        />
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
        <label style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          ключ
          <Input
            aria-label="Ключ задач"
            className="mono"
            maxLength={6}
            placeholder={projectPrefix(m.board.project.key)}
            style={{ width: 84, padding: '4px 8px', fontSize: 12, textTransform: 'uppercase' }}
            value={keyDraft}
            onChange={(e) => {
              setKeyDraft(e.target.value)
              setKeyProblem(null)
            }}
            onBlur={commitKey}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </label>
      </div>
      {keyProblem && <Problem>{keyProblem}</Problem>}
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
        <Button write variant="ghost" onClick={remove}>
          {confirm === key ? 'Точно удалить?' : 'Удалить'}
        </Button>
      </div>
      {keyAsk && (
        <IdChangeDialog
          count={keyAsk.count}
          detail={moduleKeyChangeDetail(module.key, keyAsk.next, m.board.project.key)}
          onConfirm={() => void saveKey(keyAsk.next)}
          onCancel={() => {
            setKeyAsk(null)
            setKeyDraft(module.key ?? '')
          }}
        />
      )}
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
      <Button write variant="primary" onClick={add}>
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
