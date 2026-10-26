import { useEffect, useState } from 'react'
import { Button, Input } from '../../components'
import { useBoard, useProjects } from '../../lib/api/queries'
import type { Project, UpdateProject } from '../../lib/api/types'
import {
  PROJECT_COLORS,
  PROJECT_NAME_MAX,
  PROJECT_TAB_LABELS,
  isValidKey,
  KEY_RULE,
  normalizeKey,
  type ProjectDialog,
  type ProjectTab,
} from '../../lib/project-dialogs'
import { projectKeyChangeCount, projectKeyChangeDetail } from '../../lib/task-ids'
import { useReadOnly } from '../../lib/link'
import { useUi } from '../../lib/ui-store'
import { errorText, setArchived, updateProject } from './api'
import { IdChangeDialog } from './IdChangeDialog'
import { MembersTab } from './MembersTab'
import { DialogFrame, Field, Problem, TwoStep, type FrameTab } from './parts'
import { TagsTab } from './TagsTab'

const TABS: ReadonlyArray<FrameTab<ProjectTab>> = [
  { id: 'main', label: PROJECT_TAB_LABELS.main, icon: 'sliders' },
  { id: 'members', label: PROJECT_TAB_LABELS.members, icon: 'user' },
  { id: 'tags', label: PROJECT_TAB_LABELS.tags, icon: 'filter' },
  { id: 'archive', label: PROJECT_TAB_LABELS.archive, icon: 'folder' },
]

/** Вопрос «У N задач изменятся id. Продолжить?» перед сохранением: что показать и что сделать после «Продолжить» */
type IdAsk = { count: number; detail: string; proceed: () => void }

/** «Настройки проекта» (для администратора): основное, участники, метки, архив */
export function ProjectSettingsDialog({ dialog }: { dialog: Extract<ProjectDialog, { kind: 'settings' }> }) {
  const close = useUi((s) => s.closeProjectDialog)
  const setTab = useUi((s) => s.setProjectTab)
  const projects = useProjects()
  const project = projects.data?.find((p) => p.id === dialog.id)
  const [ask, setAsk] = useState<IdAsk | null>(null)

  // проект ушёл из списка (архив, выход, меня убрали) или перестал быть моим для управления: окно закрывается
  const gone = projects.isSuccess && (!project || project.role !== 'admin')
  useEffect(() => {
    if (gone) close()
  }, [gone, close])
  if (!project) return null

  return (
    <>
      <DialogFrame
        title={`Настройки проекта «${project.name}»`}
        onClose={close}
        tabs={{ items: TABS, current: dialog.tab, onSelect: setTab, navTitle: project.name }}
      >
        {dialog.tab === 'main' && <MainTab project={project} onAsk={setAsk} />}
        {dialog.tab === 'members' && <MembersTab projectId={project.id} />}
        {dialog.tab === 'tags' && <TagsTab projectId={project.id} />}
        {dialog.tab === 'archive' && <ArchiveTab project={project} />}
      </DialogFrame>
      {ask && (
        <IdChangeDialog
          count={ask.count}
          detail={ask.detail}
          onCancel={() => setAsk(null)}
          onConfirm={() => {
            setAsk(null)
            ask.proceed()
          }}
        />
      )}
    </>
  )
}

function MainTab({ project, onAsk }: { project: Project; onAsk: (ask: IdAsk) => void }) {
  const readOnly = useReadOnly()
  const board = useBoard(project.id)
  const [name, setName] = useState(project.name)
  const [color, setColor] = useState<string>(project.color)
  const [key, setKey] = useState(project.key ?? '')
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; text: string }>({ kind: 'idle' })

  const cleanKey = normalizeKey(key)
  const keyOk = isValidKey(cleanKey)
  const patch: UpdateProject = {}
  if (name.trim() !== project.name) patch.name = name.trim()
  if (color !== project.color) patch.color = color
  if (cleanKey !== (project.key ?? '')) patch.key = cleanKey === '' ? null : cleanKey
  const dirty = Object.keys(patch).length > 0
  // от ключа зависят id задач, поэтому, пока доска не пришла, число задач неизвестно и ключ сохранять рано
  const waitingForBoard = patch.key !== undefined && board.isPending
  const canSave = dirty && name.trim() !== '' && keyOk && state.kind !== 'saving' && !waitingForBoard

  const edited = (change: () => void) => {
    change()
    setState({ kind: 'idle' })
  }

  const save = async () => {
    setState({ kind: 'saving' })
    try {
      const saved = await updateProject(project.id, patch)
      setName(saved.name)
      setColor(saved.color)
      setKey(saved.key ?? '')
      setState({ kind: 'saved' })
    } catch (e) {
      setState({ kind: 'error', text: errorText(e) })
    }
  }

  // сменился ключ, а в проекте есть задачи с его подписью: сначала спрашиваем
  const requestSave = () => {
    const count = patch.key !== undefined && board.data ? projectKeyChangeCount(board.data) : 0
    if (count > 0) onAsk({ count, detail: projectKeyChangeDetail(project.key, cleanKey || null), proceed: () => void save() })
    else void save()
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        requestSave()
      }}
    >
      <div className="fields">
        <Field label="Название" htmlFor="ps-name">
          <Input
            id="ps-name"
            maxLength={PROJECT_NAME_MAX}
            style={{ flex: '1 1 220px', maxWidth: 360 }}
            value={name}
            onChange={(e) => edited(() => setName(e.target.value))}
          />
        </Field>
        <div className="f-row">
          <span className="f-label" id="ps-color-label">
            Цвет
          </span>
          <div className="f-val" role="group" aria-labelledby="ps-color-label" style={{ gap: 8, paddingTop: 6 }}>
            {PROJECT_COLORS.map((c) => (
              <button
                key={c.value}
                className={c.value === color ? 'sw-btn on' : 'sw-btn'}
                type="button"
                aria-label={c.name}
                aria-pressed={c.value === color}
                disabled={readOnly}
                style={{ background: `var(--${c.value})` }}
                onClick={() => edited(() => setColor(c.value))}
              />
            ))}
          </div>
        </div>
        <Field label="Ключ задач" htmlFor="ps-key">
          <Input
            id="ps-key"
            maxLength={6}
            placeholder="Без ключа"
            style={{ flex: '0 1 160px' }}
            value={key}
            onChange={(e) => edited(() => setKey(e.target.value))}
            aria-describedby="ps-key-hint"
            aria-invalid={!keyOk}
          />
          <span id="ps-key-hint" className="set-desc" style={{ margin: 0, flexBasis: '100%' }}>
            Префикс номеров задач: {keyOk && cleanKey ? cleanKey : 'TASK'}-1. Если поменять ключ, сменится только подпись, номера те же.
          </span>
        </Field>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 16 }}>
        {state.kind === 'saved' && (
          <span role="status" className="set-desc" style={{ margin: 0 }}>
            Сохранено
          </span>
        )}
        {!keyOk && <Problem>{KEY_RULE}</Problem>}
        {state.kind === 'error' && <Problem>{state.text}</Problem>}
        <Button write variant="primary" type="submit" disabled={!canSave}>
          Сохранить
        </Button>
      </div>
    </form>
  )
}

function ArchiveTab({ project }: { project: Project }) {
  const close = useUi((s) => s.closeProjectDialog)
  const [problem, setProblem] = useState<string | null>(null)

  const archive = async () => {
    setProblem(null)
    try {
      await setArchived(project.id, true)
      close()
    } catch (e) {
      setProblem(errorText(e))
    }
  }

  return (
    <section>
      <div className="set-list">
        <div className="set-row">
          <div className="set-text">
            <div className="set-label">Архивировать проект</div>
            <div className="set-desc">
              Проект уйдёт из бокового меню, все задачи, документы и участники останутся. Вернуть его можно в окне «Архив проектов» в меню
              пользователя.
            </div>
          </div>
          <div className="set-ctl">
            <TwoStep id={`archive:${project.id}`} variant="default" label="Архивировать" confirmLabel="Точно архивировать?" onConfirm={() => void archive()} />
          </div>
        </div>
      </div>
      {problem && <Problem>{problem}</Problem>}
    </section>
  )
}
