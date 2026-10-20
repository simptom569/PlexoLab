import { useState } from 'react'
import { Button, DateField, EmptyState, Icon, IconButton, Input, PageHead, Panel, ProgressBar, Textarea, Tick, TitleInput } from '../../components'
import { useReleases } from '../../lib/api/queries'
import type { Milestone, Release, ReleaseItem, UpdateRelease } from '../../lib/api/types'
import { addDays } from '../../lib/date'
import { NEXT_STATUS, RELEASE_STATUS_LABELS, type WorkStatus } from '../../lib/domain'
import { milestoneWhen, percent, tasksText } from '../../lib/progress'
import { cx } from '../../lib/cx'
import { useUi } from '../../lib/ui-store'
import { useDraftField } from '../../lib/useDraft'
import { BoardLoader } from '../board/BoardLoader'
import { colorVar, useModel, useMutations } from '../board/model'
import { checklistProgress } from './cache'
import { useReleaseMutations, type ReleaseMutations } from './mutations'

/** Срок новой вехи и нового релиза, если дату не указали (addD(TODAY, 14) и addD(TODAY, 21) в макете) */
const DEFAULT_MILESTONE_DAYS = 14
const DEFAULT_RELEASE_DAYS = 21

/** Кнопка «Удалить» с подтверждением вторым нажатием (confirmThen в макете) */
function DeleteButton({ confirmKey, onDelete }: { confirmKey: string; onDelete: () => void }) {
  const confirm = useUi((s) => s.confirm)
  const setConfirm = useUi((s) => s.setConfirm)
  return (
    <Button
      variant="ghost"
      onClick={() => {
        if (confirm === confirmKey) {
          setConfirm(null)
          onDelete()
        } else setConfirm(confirmKey)
      }}
    >
      {confirm === confirmKey ? 'Точно удалить?' : 'Удалить'}
    </Button>
  )
}

// ----- Вехи -----

function MilestoneRow({ milestone }: { milestone: Milestone }) {
  const m = useModel()
  const { updateMilestone, deleteMilestone } = useMutations()
  const title = useDraftField(milestone.title, (next) => updateMilestone.mutate({ id: milestone.id, patch: { title: next } }))
  const pct = percent(milestone.tasks_done, milestone.tasks_total)
  const when = milestoneWhen(milestone.due_date, m.today, pct)

  return (
    <div className="ms-row">
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <TitleInput style={{ fontSize: 14 }} aria-label="Название вехи" {...title} />
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          <span className={when.late ? 'late' : undefined}>{when.text}</span>
          {` · ${tasksText(milestone.tasks_done, milestone.tasks_total)}`}
        </span>
      </div>
      <DateField
        aria-label="Дата вехи"
        value={milestone.due_date}
        onChange={(v) => v && updateMilestone.mutate({ id: milestone.id, patch: { due_date: v } })}
      />
      <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10 }}>
        <ProgressBar ok={pct === 100} pct={pct} style={{ flex: 1 }} />
        <span style={{ fontSize: 12, fontWeight: 600, minWidth: 34, textAlign: 'right' }}>{`${pct}%`}</span>
        <DeleteButton confirmKey={`ms:${milestone.id}`} onDelete={() => deleteMilestone.mutate({ id: milestone.id })} />
      </div>
    </div>
  )
}

function NewMilestone() {
  const m = useModel()
  const { createMilestone } = useMutations()
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const add = () => {
    const value = title.trim()
    if (!value) return
    createMilestone.mutate({ title: value, dueDate: date || addDays(m.today, DEFAULT_MILESTONE_DAYS) })
    setTitle('')
    setDate('')
  }
  return (
    <div className="ms-row" style={{ background: 'var(--surface2)' }}>
      <Input
        placeholder="Новая веха"
        aria-label="Название новой вехи"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add()
        }}
      />
      <DateField clearable aria-label="Дата новой вехи" value={date} onChange={setDate} />
      <div style={{ gridColumn: '1 / -1' }}>
        <Button onClick={add}>Добавить веху</Button>
      </div>
    </div>
  )
}

function Milestones() {
  const m = useModel()
  const list = m.board.milestones
  return (
    <section style={{ flex: '1 1 340px', minWidth: 0 }} aria-label="Вехи">
      <h2 className="sec-h">Вехи</h2>
      <div className="sheet">
        {list.map((milestone) => (
          <MilestoneRow key={milestone.id} milestone={milestone} />
        ))}
        {list.length === 0 && <div style={{ padding: '18px 16px', color: 'var(--muted)' }}>Вех пока нет</div>}
        <NewMilestone />
      </div>
    </section>
  )
}

// ----- Релизы -----

function Step({ release, item, mutations }: { release: Release; item: ReleaseItem; mutations: ReleaseMutations }) {
  const { updateItem, deleteItem } = mutations
  const title = useDraftField(item.title, (next) => updateItem.mutate({ releaseId: release.id, id: item.id, patch: { title: next } }))
  return (
    <div className="sub-row">
      <Tick
        done={item.done}
        label="Отметить шаг"
        onClick={() => updateItem.mutate({ releaseId: release.id, id: item.id, patch: { done: !item.done } })}
      />
      <input className={cx('sub-input', item.done && 'done')} aria-label="Шаг выкатки" {...title} />
      <IconButton icon="close" small label="Удалить шаг" onClick={() => deleteItem.mutate({ releaseId: release.id, id: item.id })} />
    </div>
  )
}

function NewStep({ release, mutations }: { release: Release; mutations: ReleaseMutations }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const title = draft.trim()
    if (!title) return
    mutations.createItem.mutate({ releaseId: release.id, title })
    setDraft('')
  }
  return (
    <div className="sub-row">
      <span style={{ width: 18, display: 'inline-flex', justifyContent: 'center', color: 'var(--muted)' }}>
        <Icon name="plus" sm />
      </span>
      <input
        className="sub-input"
        placeholder="Добавить шаг и нажать Enter"
        aria-label="Новый шаг выкатки"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add()
        }}
      />
    </div>
  )
}

function ReleaseCard({ release, mutations }: { release: Release; mutations: ReleaseMutations }) {
  const { updateRelease, deleteRelease } = mutations
  const update = (patch: UpdateRelease) => updateRelease.mutate({ id: release.id, patch })
  const version = useDraftField(release.version, (next) => update({ version: next }))
  const notes = useDraftField(release.notes, (next) => update({ notes: next }), { allowEmpty: true, trim: false })
  const status = release.status as WorkStatus
  const { done, total, pct } = checklistProgress(release)

  return (
    <Panel>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <TitleInput className="mono" style={{ maxWidth: 150 }} aria-label="Версия" {...version} />
        <button className={`pill-btn ${status}`} type="button" title="Сменить статус" onClick={() => update({ status: NEXT_STATUS[status] })}>
          {RELEASE_STATUS_LABELS[status]}
        </button>
        <span style={{ flex: 1 }} />
        <DateField
          aria-label="Дата релиза"
          value={release.release_date}
          onChange={(v) => v && update({ release_date: v })}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: 'var(--muted)' }}>{`Чек-лист выкатки: ${done} из ${total}`}</span>
          <strong>{`${pct}%`}</strong>
        </div>
        <ProgressBar ok={pct === 100} pct={pct} />
      </div>
      <div>
        {release.items.map((item) => (
          <Step key={item.id} release={release} item={item} mutations={mutations} />
        ))}
        <NewStep release={release} mutations={mutations} />
      </div>
      <div>
        <h3 className="sec-title">Что вошло в релиз</h3>
        <Textarea placeholder="Список изменений (changelog)" aria-label="Список изменений" {...notes} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <DeleteButton confirmKey={`rel:${release.id}`} onDelete={() => deleteRelease.mutate({ id: release.id })} />
      </div>
    </Panel>
  )
}

function NewRelease({ mutations }: { mutations: ReleaseMutations }) {
  const m = useModel()
  const [version, setVersion] = useState('')
  const add = () => {
    const value = version.trim()
    if (!value) return
    mutations.createRelease.mutate({ version: value, date: addDays(m.today, DEFAULT_RELEASE_DAYS) })
    setVersion('')
  }
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <Input
        style={{ width: 150 }}
        placeholder="Версия, например 3.0.0"
        aria-label="Версия нового релиза"
        value={version}
        onChange={(e) => setVersion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add()
        }}
      />
      <Button onClick={add}>Новый релиз</Button>
    </div>
  )
}

function Releases({ projectId }: { projectId: string }) {
  const releases = useReleases(projectId)
  const mutations = useReleaseMutations(projectId)
  return (
    <section style={{ flex: '2 1 460px', minWidth: 0 }} aria-label="Релизы">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <h2 className="sec-h" style={{ margin: 0 }}>
          Релизы
        </h2>
        <NewRelease mutations={mutations} />
      </div>
      {releases.isError && (
        <EmptyState>
          Не удалось загрузить релизы
          <div style={{ marginTop: 12 }}>
            <Button onClick={() => void releases.refetch()}>Повторить</Button>
          </div>
        </EmptyState>
      )}
      {!releases.isError && !releases.data && <EmptyState>Загружаю релизы…</EmptyState>}
      {releases.data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {releases.data.map((release) => (
            <ReleaseCard key={release.id} release={release} mutations={mutations} />
          ))}
          {releases.data.length === 0 && <EmptyState>Релизов пока нет</EmptyState>}
        </div>
      )}
    </section>
  )
}

function ReleasesScreen() {
  const m = useModel()
  return (
    <>
      <PageHead
        projectName={m.board.project.name}
        projectColor={colorVar(m.board.project.color)}
        title="Релизы и вехи"
        subtitle="Вехи — контрольные точки со сроком, к ним привязываются задачи. Релиз — версия с чек-листом выкатки и списком изменений."
      />
      <div className="two-col">
        <Milestones />
        <Releases projectId={m.projectId} />
      </div>
    </>
  )
}

/** Страница «Релизы и вехи» выбранного проекта */
export function ReleasesPage({ projectId }: { projectId: string }) {
  return (
    <BoardLoader projectId={projectId} what="вехи">
      <ReleasesScreen />
    </BoardLoader>
  )
}
