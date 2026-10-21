import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { Button, ConfirmDelete, ConflictBanner, EmptyState, Icon, Input, MarkdownEditor, Segmented } from '../../components'
import { useDoc, useWiki } from '../../lib/api/queries'
import { ApiError } from '../../lib/api/client'
import type { Doc, DocMode, ObjectKind } from '../../lib/api/types'
import { cx } from '../../lib/cx'
import { openExternal } from '../../lib/platform/opener'
import { TONES, toneAt } from '../../lib/tones'
import { newId } from '../../lib/uuid'
import { useOpenWikiLink } from '../wiki/actions'
import { lowerTitles } from '../wiki/logic'
import { OBJECT_TOOLS, addObject, canvasLines, moveNote, newObject, patchObject, removeObject, toggleLink } from './canvas'
import { useCanvasDraft, useDocDraft } from './drafts'
import { starLabel } from './logic'
import { useDeleteDoc, useSetDocMode, useStarDoc } from './mutations'
import { useDocsStore } from './store'

const MODES: ReadonlyArray<{ value: DocMode; label: string }> = [
  { value: 'page', label: 'Страница' },
  { value: 'edge', label: 'Холст' },
]

/** Что сейчас тащат: объект или карточка с текстом, откуда начали (_wb в макете) */
type Grab = { kind: 'item' | 'note'; id: string; sx: number; sy: number; ox: number; oy: number }

const HINT = 'Текст документа лежит на холсте карточкой: её можно двигать за верхнюю полоску. Фигуры и стикеры двигаются мышью, у выбранного можно поменять текст и цвет.'
const HINT_CONNECT = 'Режим стрелок: нажми два объекта подряд, чтобы соединить их. Повторное соединение той же пары убирает стрелку.'

/** Загруженный документ: сверху «Все документы», режим, звёздочка, «Удалить»; ниже страница или холст */
function LoadedDoc({ doc }: { doc: Doc }) {
  const { draft, state } = useDocDraft(doc)
  const { draft: cv, state: canvas } = useCanvasDraft(doc)
  const pages = useWiki().data ?? []
  const openLink = useOpenWikiLink()
  const closeDoc = useDocsStore((s) => s.closeDoc)
  const autoEdit = useDocsStore((s) => s.editNew === doc.id)
  const editStarted = useDocsStore((s) => s.editStarted)
  const star = useStarDoc()
  const setMode = useSetDocMode()
  const deleteDoc = useDeleteDoc()

  // новый документ открылся сразу на первом блоке: «просьба» выполнена, повторять при возврате не нужно
  useEffect(() => {
    if (autoEdit) editStarted()
  }, [autoEdit, editStarted])

  const edge = doc.mode === 'edge'
  // выбранный объект (wbSel), объект, от которого тянут стрелку (wbFrom), и режим стрелок (wbConnect)
  const [sel, setSel] = useState<string | null>(null)
  const [from, setFrom] = useState<string | null>(null)
  const [connect, setConnect] = useState(false)
  const grab = useRef<Grab | null>(null)
  const selected = edge ? (canvas.objects.find((o) => o.id === sel) ?? null) : null

  const pickMode = (mode: DocMode) => {
    if (mode === doc.mode) return
    setMode.mutate({ id: doc.id, mode })
    setSel(null)
    setFrom(null)
    setConnect(false)
  }

  /** Нажатие на объект в режиме стрелок: первый объект запоминается, второй соединяется с ним (wbLink) */
  const link = (id: string) => {
    if (!from || from === id) {
      setFrom(from === id ? null : id)
      setSel(id)
      return
    }
    cv.change((s) => toggleLink(s, from, id))
    setFrom(null)
    setSel(id)
  }

  const itemDown = (id: string) => (e: PointerEvent<HTMLElement>) => {
    if (connect) return link(id)
    const it = canvas.objects.find((o) => o.id === id)
    if (!it) return
    grab.current = { kind: 'item', id, sx: e.clientX, sy: e.clientY, ox: it.x, oy: it.y }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // захват не удался (указатель уже отпущен): объект всё равно выбран
    }
    if (sel !== id) setSel(id)
  }

  // с клавиатуры нажатие на объект приходит как click без указателя: выбирает объект или тянет стрелку
  const itemKey = (id: string) => (e: MouseEvent<HTMLElement>) => {
    if (e.detail !== 0) return
    if (connect) link(id)
    else setSel(id)
  }

  const noteDown = (e: PointerEvent<HTMLElement>) => {
    grab.current = { kind: 'note', id: doc.id, sx: e.clientX, sy: e.clientY, ox: canvas.note.x, oy: canvas.note.y }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // см. выше
    }
    setSel(null)
    setFrom(null)
  }

  // во время движения меняется только локальное состояние, на сервер холст уйдёт, когда указатель отпустят
  const move = (e: PointerEvent<HTMLElement>) => {
    const g = grab.current
    if (!g) return
    const x = Math.max(0, g.ox + e.clientX - g.sx)
    const y = Math.max(0, g.oy + e.clientY - g.sy)
    cv.change((s) => (g.kind === 'note' ? moveNote(s, x, y) : patchObject(s, g.id, { x, y })), { save: false })
  }

  const release = () => {
    if (!grab.current) return
    grab.current = null
    cv.commit()
  }

  const add = (kind: ObjectKind) => {
    const object = newObject(canvas, kind, newId())
    cv.change((s) => addObject(s, object))
    setSel(object.id)
  }

  const label = starLabel(doc.starred)

  return (
    <>
      <div className="dbar">
        <Button variant="ghost" onClick={closeDoc}>
          <Icon name="chevronLeft" sm />
          Все документы
        </Button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Segmented label="Режим документа" options={MODES} value={doc.mode} onChange={pickMode} />
          <button
            className={cx('icon-btn', 'dstar-inline', doc.starred && 'on')}
            type="button"
            aria-label={label}
            title={label}
            onClick={() => star.mutate({ id: doc.id, starred: !doc.starred })}
          >
            <Icon name="star" />
          </button>
          <ConfirmDelete confirmKey={`doc:${doc.id}`} onConfirm={() => deleteDoc.mutate({ id: doc.id })} />
        </div>
      </div>
      <div className="cv-wrap">
        <div
          className={cx('cv', edge ? 'edge' : 'page')}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              setSel(null)
              setFrom(null)
            }
          }}
          onPointerMove={move}
          onPointerUp={release}
          onPointerCancel={release}
        >
          {edge &&
            canvasLines(canvas).map((ln, i) => (
              <div key={i} className="wb-line" style={{ left: ln.x, top: ln.y, width: ln.len, transform: `rotate(${ln.ang}deg)` }} />
            ))}
          {edge &&
            canvas.objects.map((it) => {
              const text = it.type === 'text'
              const tone = toneAt(it.color)
              return (
                <button
                  key={it.id}
                  className={cx('wb-item', it.type, (sel === it.id || from === it.id) && 'sel')}
                  type="button"
                  style={{
                    left: it.x,
                    top: it.y,
                    width: it.w,
                    height: it.h,
                    background: text ? 'transparent' : tone.bg,
                    color: text ? 'var(--ink)' : tone.fg,
                  }}
                  onPointerDown={itemDown(it.id)}
                  onClick={itemKey(it.id)}
                >
                  {it.text || (text ? 'Текст' : 'Пусто')}
                </button>
              )
            })}
          <div
            className={cx('note', edge ? 'edge' : 'page')}
            style={{ left: canvas.note.x, top: canvas.note.y, width: edge ? `${canvas.note.w}px` : '100%' }}
          >
            {edge && (
              <div className="note-grip" role="presentation" title="Перетащить карточку с текстом" onPointerDown={noteDown}>
                <span />
              </div>
            )}
            <input
              className="doc-title"
              placeholder="Без названия"
              aria-label="Название документа"
              value={state.title}
              onChange={(e) => draft.setTitle(e.target.value)}
            />
            {state.conflict && <ConflictBanner message="Документ изменил другой участник" onTheirs={() => draft.acceptTheirs()} onMine={() => draft.keepMine()} />}
            <MarkdownEditor
              // чужая версия заменила текст: редактор начинается заново
              key={state.resetKey}
              md={state.md}
              onChange={(md) => draft.setMd(md)}
              wikiTitles={lowerTitles(pages)}
              onOpenWiki={openLink}
              onOpenUrl={(url) => void openExternal(url)}
              autoEdit={autoEdit}
              onFinish={() => void draft.flush()}
              restore={state.restore}
              registerProbe={draft.setActiveProbe}
            />
          </div>
        </div>
        {edge && (
          <div className="eg-tools" role="toolbar" aria-label="Инструменты холста">
            {OBJECT_TOOLS.map((t) => (
              <Button key={t.kind} onClick={() => add(t.kind)}>
                + {t.label}
              </Button>
            ))}
            <Button
              on={connect}
              aria-pressed={connect}
              onClick={() => {
                setConnect(!connect)
                setFrom(null)
              }}
            >
              Стрелка
            </Button>
            {selected && (
              <>
                <span style={{ width: 1, height: 24, background: 'var(--line)' }} />
                <Input
                  style={{ width: 180 }}
                  aria-label="Текст выбранного объекта"
                  placeholder="Текст объекта"
                  value={selected.text}
                  onChange={(e) => cv.change((s) => patchObject(s, selected.id, { text: e.target.value }))}
                />
                <div style={{ display: 'flex', gap: 6 }} role="group" aria-label="Цвет объекта">
                  {TONES.map((tone, i) => (
                    <button
                      key={i}
                      className="sw-btn"
                      type="button"
                      aria-label="Цвет объекта"
                      style={{ background: tone.fg }}
                      onClick={() => cv.change((s) => patchObject(s, selected.id, { color: i }))}
                    />
                  ))}
                </div>
                <Button
                  danger
                  onClick={() => {
                    cv.change((s) => removeObject(s, selected.id))
                    setSel(null)
                  }}
                >
                  Удалить
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {edge && <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>{connect ? HINT_CONNECT : HINT}</p>}
    </>
  )
}

/**
 * Открытый документ проекта: загружает его и показывает. Если такого документа уже нет или он из другого проекта
 * (сохранённый с прошлого раза, а проект сменили), возвращает к списку.
 */
export function DocView({ id, projectId }: { id: string; projectId: string }) {
  const doc = useDoc(id)
  const closeDoc = useDocsStore((s) => s.closeDoc)
  const gone = doc.error instanceof ApiError && doc.error.status === 404
  const elsewhere = doc.data !== undefined && doc.data.project_id !== projectId

  // сохранённый с прошлого раза документ удалили (или он был удалён, пока окно было закрыто) или он лежит в другом проекте
  useEffect(() => {
    if (gone || elsewhere) closeDoc()
  }, [gone, elsewhere, closeDoc])

  if (doc.isPending || gone || elsewhere) return <EmptyState>Загружаю документ…</EmptyState>
  if (doc.isError) {
    return (
      <EmptyState>
        Не удалось загрузить документ
        <div style={{ marginTop: 12 }}>
          <Button onClick={() => void doc.refetch()}>Повторить</Button>
          <Button variant="ghost" onClick={closeDoc}>
            Все документы
          </Button>
        </div>
      </EmptyState>
    )
  }
  return <LoadedDoc key={id} doc={doc.data} />
}
