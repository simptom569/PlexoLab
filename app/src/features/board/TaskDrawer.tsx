import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Avatar, Button, Icon, IconButton, Input, Opt, Pill, PriorityBars, ProgressBar, Textarea, Tick } from '../../components'
import { useTask } from '../../lib/api/queries'
import type { Comment, Subtask, TaskCard, TaskDetail, UpdateTask } from '../../lib/api/types'
import { cx } from '../../lib/cx'
import { whenText } from '../../lib/date'
import { PRIORITY_LABELS, type Priority } from '../../lib/domain'
import { formatSize } from '../../lib/format'
import { toneAt } from '../../lib/tones'
import { useUi } from '../../lib/ui-store'
import { useDraft } from '../../lib/useDraft'
import { cardOf } from './cache'
import { BoardProvider } from './BoardProvider'
import { colorVar, useBoardModel, useModel, useMutations } from './model'
import { useToggleDone } from './useToggleDone'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="f-row">
      <span className="f-label">{label}</span>
      <div className="f-val">{children}</div>
    </div>
  )
}

function TitleField({ task }: { task: TaskCard }) {
  const { updateTask } = useMutations()
  const focusTitle = useUi((s) => s.focusTitle)
  const [draft, setDraft] = useDraft(task.title)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focusTitle) {
      ref.current?.focus()
      ref.current?.select()
    }
  }, [focusTitle])
  const commit = () => {
    const title = draft.trim()
    if (!title) setDraft(task.title)
    else if (title !== task.title) updateTask.mutate({ id: task.id, patch: { title } })
  }
  return (
    <input
      ref={ref}
      className="dr-title"
      aria-label="Название задачи"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}

function Fields({ task }: { task: TaskCard }) {
  const m = useModel()
  const { moveTask, updateTask, createTag } = useMutations()
  const [tagDraft, setTagDraft] = useState('')
  const [pr, setPr] = useDraft(task.pr)
  const update = (patch: UpdateTask) => updateTask.mutate({ id: task.id, patch })

  const addTag = () => {
    const label = tagDraft.trim()
    if (!label) return
    setTagDraft('')
    createTag.mutate(
      { label },
      { onSuccess: (tag) => !task.tag_ids.includes(tag.id) && update({ tag_ids: [...task.tag_ids, tag.id] }) },
    )
  }

  const choose = (label: string, on: boolean, pick: () => void) => (
    <Opt key={label} on={on} onClick={pick}>
      {label}
    </Opt>
  )

  return (
    <div className="fields">
      <Row label="Статус">
        {[{ id: null, title: 'Бэклог', color: 'var(--muted)' }, ...m.columns.map((c) => ({ id: c.id, title: c.title, color: colorVar(c.color) }))].map((s) => (
          <Opt
            key={s.id ?? 'backlog'}
            on={(task.column_id ?? null) === s.id}
            swatch={s.color}
            onClick={() => moveTask.mutate({ id: task.id, columnId: s.id, beforeId: null })}
          >
            {s.title}
          </Opt>
        ))}
      </Row>
      <Row label="Исполнитель">
        <Opt on={!task.assignee_id} onClick={() => update({ assignee_id: null })}>
          <Avatar name={null} size="sm" decorative />
          Никто
        </Opt>
        {m.users.map((u) => (
          <Opt key={u.id} on={task.assignee_id === u.id} onClick={() => update({ assignee_id: u.id })}>
            <Avatar name={u.name} tone={u.tone} size="sm" decorative />
            {u.name}
          </Opt>
        ))}
      </Row>
      <Row label="Срок">
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)' }}>
          Начало <Input type="date" value={task.start_date ?? ''} onChange={(e) => update({ start_date: e.target.value || null })} />
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)' }}>
          Срок <Input type="date" value={task.due_date ?? ''} onChange={(e) => update({ due_date: e.target.value || null })} />
        </label>
      </Row>
      <Row label="Приоритет">
        {(['high', 'med', 'low'] as Priority[]).map((k) => (
          <Opt key={k} on={task.priority === k} onClick={() => update({ priority: k })}>
            <PriorityBars prio={k} />
            {PRIORITY_LABELS[k]}
          </Opt>
        ))}
      </Row>
      <Row label="Метки">
        {m.board.tags.map((tag) => {
          const on = task.tag_ids.includes(tag.id)
          return (
            <Opt
              key={tag.id}
              on={on}
              swatch={toneAt(tag.tone).fg}
              onClick={() => update({ tag_ids: on ? task.tag_ids.filter((id) => id !== tag.id) : [...task.tag_ids, tag.id] })}
            >
              {tag.label}
            </Opt>
          )
        })}
        <Input
          style={{ width: 140, padding: '5px 10px', fontSize: 13 }}
          placeholder="+ новая метка"
          aria-label="Новая метка"
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTag()}
        />
      </Row>
      <Row label="Модуль">
        {choose('Не выбран', !task.module_id, () => update({ module_id: null }))}
        {m.board.modules.map((mod) => choose(mod.title, task.module_id === mod.id, () => update({ module_id: mod.id })))}
      </Row>
      <Row label="Веха">
        {choose('Не выбран', !task.milestone_id, () => update({ milestone_id: null }))}
        {m.board.milestones.map((ms) => choose(ms.title, task.milestone_id === ms.id, () => update({ milestone_id: ms.id })))}
      </Row>
      <Row label="Pull request">
        <Input
          style={{ width: 140 }}
          placeholder="#000"
          aria-label="Номер PR"
          value={pr}
          onChange={(e) => setPr(e.target.value)}
          onBlur={() => pr !== task.pr && update({ pr })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </Row>
    </div>
  )
}

function Description({ detail }: { detail: TaskDetail }) {
  const { updateTask } = useMutations()
  const [draft, setDraft] = useDraft(detail.description)
  return (
    <div>
      <h3 className="sec-title">Описание</h3>
      <Textarea
        placeholder="Что нужно сделать, критерии готовности, ссылки"
        aria-label="Описание"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== detail.description && updateTask.mutate({ id: detail.id, patch: { description: draft } })}
      />
    </div>
  )
}

function SubtaskRow({ taskId, subtask }: { taskId: string; subtask: Subtask }) {
  const { updateSubtask, deleteSubtask } = useMutations()
  const [draft, setDraft] = useDraft(subtask.title)
  const cls = subtask.done ? 'done' : ''
  return (
    <div className="sub-row">
      <Tick done={subtask.done} label="Отметить подзадачу" onClick={() => updateSubtask.mutate({ taskId, id: subtask.id, patch: { done: !subtask.done } })} />
      <input
        className={cx('sub-input', cls)}
        aria-label="Подзадача"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const title = draft.trim()
          if (!title) setDraft(subtask.title)
          else if (title !== subtask.title) updateSubtask.mutate({ taskId, id: subtask.id, patch: { title } })
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <IconButton icon="close" small label="Удалить подзадачу" onClick={() => deleteSubtask.mutate({ taskId, id: subtask.id })} />
    </div>
  )
}

function Subtasks({ detail }: { detail: TaskDetail }) {
  const { createSubtask } = useMutations()
  const [draft, setDraft] = useState('')
  const done = detail.subtasks.filter((s) => s.done).length
  const total = detail.subtasks.length
  const add = () => {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    createSubtask.mutate({ taskId: detail.id, title })
  }
  return (
    <div>
      <h3 className="sec-title">
        Подзадачи <Pill>{`${done}/${total}`}</Pill>
      </h3>
      <ProgressBar small pct={total ? Math.round((done / total) * 100) : 0} style={{ marginBottom: 10 }} />
      {detail.subtasks.map((s) => (
        <SubtaskRow key={s.id} taskId={detail.id} subtask={s} />
      ))}
      <div className="sub-row">
        <span style={{ width: 18, display: 'inline-flex', justifyContent: 'center', color: 'var(--muted)' }}>
          <Icon name="plus" sm />
        </span>
        <input
          className="sub-input"
          placeholder="Добавить подзадачу и нажать Enter"
          aria-label="Новая подзадача"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
      </div>
    </div>
  )
}

function Files({ detail }: { detail: TaskDetail }) {
  // Загрузка и удаление файлов приходят вместе с вики и файлами (этап 5): пока вложения только показываются
  return (
    <div>
      <h3 className="sec-title">
        Вложения <Pill>{detail.files.length}</Pill>
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {detail.files.map((f) => (
          <div key={f.id} className="file-row">
            <Icon name="docs" />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{formatSize(f.size_bytes)}</span>
          </div>
        ))}
        <button className="btn" type="button" disabled title="Загрузка файлов появится вместе с разделом «Вики»" style={{ alignSelf: 'flex-start' }}>
          <Icon name="paperclip" sm />
          Прикрепить файл
        </button>
      </div>
    </div>
  )
}

function CommentItem({ comment }: { comment: Comment }) {
  const m = useModel()
  const author = m.usersById.get(comment.author_id)
  return (
    <div className="comment">
      <Avatar name={author?.name ?? null} tone={author?.tone} emptyLabel="Неизвестный автор" decorative />
      <div className="bubble">
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          <strong style={{ color: 'var(--ink)' }}>{author?.name ?? 'Неизвестный автор'}</strong> · {whenText(comment.created_at)}
        </div>
        <div>{comment.body}</div>
      </div>
    </div>
  )
}

function Comments({ detail }: { detail: TaskDetail }) {
  const m = useModel()
  const { createComment } = useMutations()
  const [draft, setDraft] = useState('')
  const send = () => {
    const body = draft.trim()
    if (!body) return
    setDraft('')
    createComment.mutate({ taskId: detail.id, body })
  }
  return (
    <div>
      <h3 className="sec-title">
        Комментарии <Pill>{detail.comments.length}</Pill>
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {detail.comments.map((c) => (
          <CommentItem key={c.id} comment={c} />
        ))}
        <div className="comment">
          <Avatar name={m.me.name} tone={m.me.tone} decorative />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            <Textarea
              style={{ minHeight: 64 }}
              placeholder="Написать комментарий"
              aria-label="Комментарий"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button style={{ alignSelf: 'flex-end' }} onClick={send}>
              Отправить
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function DrawerBody({ card, detail }: { card: TaskCard; detail: TaskDetail | undefined }) {
  const { deleteTask } = useMutations()
  const { closeTask, confirmDelete, setConfirmDelete } = useUi()
  const toggleDone = useToggleDone()
  const m = useModel()
  const task = detail ? cardOf(detail) : card
  const done = m.done(task)

  const remove = () => {
    if (!confirmDelete) return setConfirmDelete(true)
    deleteTask.mutate({ id: task.id })
    closeTask()
  }

  return (
    <>
      <button className="scrim" type="button" aria-label="Закрыть задачу" onClick={closeTask} />
      <aside className="drawer" role="dialog" aria-label={`Задача ${task.key}`}>
        <div className="dr-head">
          <Button on={done} onClick={() => toggleDone(task)}>
            <Icon name="check" sm />
            {done ? 'Выполнена' : 'Отметить выполненной'}
          </Button>
          <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
            {task.key}
          </span>
          <span style={{ flex: 1 }} />
          <Button danger onClick={remove}>
            <Icon name="trash" sm />
            {confirmDelete ? 'Точно удалить?' : 'Удалить'}
          </Button>
          <IconButton icon="close" label="Закрыть" onClick={closeTask} />
        </div>
        <div className="dr-body">
          <TitleField task={task} />
          <Fields task={task} />
          {detail && (
            <>
              <Description detail={detail} />
              <Subtasks detail={detail} />
              <Files detail={detail} />
              <Comments detail={detail} />
            </>
          )}
        </div>
      </aside>
    </>
  )
}

function DrawerLoader({ taskId }: { taskId: string }) {
  const m = useModel()
  const closeTask = useUi((s) => s.closeTask)
  const detail = useTask(taskId)
  const card = m.board.tasks.find((t) => t.id === taskId)

  // задачу удалили (в том числе другой человек) или она из другого проекта
  const missing = !card && (detail.isError || detail.data !== undefined)
  useEffect(() => {
    if (missing) closeTask()
  }, [missing, closeTask])

  const known = card ?? (detail.data ? cardOf(detail.data) : undefined)
  if (!known) return null
  return <DrawerBody card={known} detail={detail.data} />
}

/** Правая панель задачи: открывается из любого вида доски */
export function TaskDrawer({ projectId }: { projectId: string }) {
  const openTaskId = useUi((s) => s.openTaskId)
  const loaded = useBoardModel(projectId)
  if (!openTaskId || loaded.status !== 'ready') return null
  return (
    <BoardProvider model={loaded.model}>
      <DrawerLoader taskId={openTaskId} />
    </BoardProvider>
  )
}
