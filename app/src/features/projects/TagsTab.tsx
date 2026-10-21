import { useState } from 'react'
import { Button, Input } from '../../components'
import { useBoard } from '../../lib/api/queries'
import type { Tag } from '../../lib/api/types'
import { TONES } from '../../lib/tones'
import { createTag, deleteTag, errorText, updateTag } from './api'
import { Problem, TwoStep } from './parts'

// цвета меток различаются на глаз; для скринридера они просто пронумерованы
const toneName = (i: number) => `Цвет ${i + 1}`
const LABEL_MAX = 50

/** «Метки»: список меток проекта; администратор добавляет, переименовывает, перекрашивает и удаляет */
export function TagsTab({ projectId }: { projectId: string }) {
  const board = useBoard(projectId)
  const [problem, setProblem] = useState<string | null>(null)
  const [label, setLabel] = useState('')

  const act = async (work: () => Promise<void>) => {
    setProblem(null)
    try {
      await work()
    } catch (e) {
      setProblem(errorText(e))
    }
  }

  if (board.isPending) return <div className="empty">Загружаю…</div>
  if (board.isError || !board.data) return <Problem>Не удалось загрузить метки</Problem>

  const { tags, tasks } = board.data
  const usage = (id: string) => tasks.filter((t) => t.tag_ids.includes(id)).length

  return (
    <>
      <section>
        <h3 className="sec-title">Метки проекта</h3>
        {tags.length === 0 ? (
          <div className="empty">Меток пока нет. Добавьте первую здесь или прямо в окне задачи.</div>
        ) : (
          <div className="proj-rows" aria-label="Метки проекта">
            {tags.map((tag) => (
              <TagRow key={tag.id} tag={tag} used={usage(tag.id)} projectId={projectId} act={act} />
            ))}
          </div>
        )}
      </section>
      <section>
        <h3 className="sec-title">Новая метка</h3>
        <form
          style={{ display: 'flex', gap: 8, alignItems: 'center' }}
          onSubmit={(e) => {
            e.preventDefault()
            const name = label.trim()
            if (!name) return
            void act(async () => {
              await createTag(projectId, name)
              setLabel('')
            })
          }}
        >
          <Input
            aria-label="Название новой метки"
            maxLength={LABEL_MAX}
            placeholder="Название"
            style={{ flex: '1 1 220px' }}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button variant="primary" type="submit" disabled={label.trim() === ''}>
            Добавить
          </Button>
        </form>
      </section>
      {problem && <Problem>{problem}</Problem>}
    </>
  )
}

function TagRow({ tag, used, projectId, act }: { tag: Tag; used: number; projectId: string; act: (work: () => Promise<void>) => Promise<void> }) {
  const [name, setName] = useState(tag.label)
  const [seen, setSeen] = useState(tag.label)
  // название могли поменять на другом устройстве: поле подхватывает новое, пока человек его не правит
  if (tag.label !== seen) {
    setSeen(tag.label)
    setName(tag.label)
  }

  const commit = () => {
    const next = name.trim()
    if (next === '' || next === tag.label) return setName(tag.label)
    void act(async () => {
      try {
        await updateTag(projectId, tag.id, { label: next })
      } catch (e) {
        setName(tag.label)
        throw e
      }
    })
  }

  return (
    <div className="proj-row">
      <Input
        aria-label={`Название метки «${tag.label}»`}
        maxLength={LABEL_MAX}
        style={{ flex: '1 1 160px', minWidth: 0 }}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <div className="tag-edit">
        <div role="group" aria-label={`Цвет метки «${tag.label}»`} style={{ display: 'flex', gap: 6 }}>
          {TONES.map((tone, i) => (
            <button
              key={toneName(i)}
              className={i === tag.tone ? 'sw-btn on' : 'sw-btn'}
              type="button"
              aria-label={toneName(i)}
              aria-pressed={i === tag.tone}
              style={{ background: tone.fg }}
              onClick={() => i !== tag.tone && void act(() => updateTag(projectId, tag.id, { tone: i }).then(() => undefined))}
            />
          ))}
        </div>
        <TwoStep
          id={`tag:${tag.id}`}
          label="Удалить"
          confirmLabel={used > 0 ? `Точно? Метка стоит на ${tasksText(used)}` : 'Точно удалить?'}
          onConfirm={() => void act(() => deleteTag(projectId, tag.id))}
        />
      </div>
    </div>
  )
}

/** «1 задаче», «2 задачах», «5 задачах»: после «на» предложный падеж */
function tasksText(n: number): string {
  return n % 10 === 1 && n % 100 !== 11 ? `${n} задаче` : `${n} задачах`
}
