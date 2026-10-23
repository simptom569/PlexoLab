import { useEffect, useRef, useState, type CSSProperties, type FocusEvent, type MouseEvent, type PointerEvent } from 'react'
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
import { OBJECT_TOOLS, addObject, canvasBounds, canvasLines, moveNote, newObject, patchObject, removeObject, toggleLink } from './canvas'
import { MAX_ZOOM, MIN_ZOOM, clampCoord, edgeVelocity, gridStyle, panBy, revealCamera, tidy, toWorld, visibleRect, type Camera, type Point } from './camera'
import { usePagePresence } from '../wiki/presence'
import { useCanvasDraft, useDocDraft } from './drafts'
import { starLabel } from './logic'
import { useDeleteDoc, useSetDocMode, useStarDoc } from './mutations'
import { useDocsStore } from './store'
import { useCanvasView } from './useCanvasView'

const MODES: ReadonlyArray<{ value: DocMode; label: string }> = [
  { value: 'page', label: 'Страница' },
  { value: 'edge', label: 'Холст' },
]

/**
 * Что сейчас тащат: объект или карточка с текстом (_wb в макете). `dx`, `dy`: где угол объекта относительно указателя в
 * координатах холста (они не меняются, пока тащат, даже если холст при этом едет). `sx`, `sy`: где нажали на экране;
 * `moved`: указатель ушёл от места нажатия достаточно далеко, чтобы это было перетаскиванием, а не кликом.
 */
type Grab = { kind: 'item' | 'note'; id: string; dx: number; dy: number; sx: number; sy: number; moved: boolean }

/** Холст двигают пустым местом: что взяли и какой была камера */
type PanGrab = { sx: number; sy: number; cam: Camera }

/** Меньше скольки пикселей от места нажатия движение ещё считается кликом: у края окна холст при этом не едет */
const DRAG_SLOP = 4

/** Сетка точек на фоне едет и масштабируется вместе с холстом; в покое это шаг 22 и нулевой сдвиг, как в макете */
function gridBackground(cam: Camera): CSSProperties {
  const grid = gridStyle(cam)
  return { backgroundSize: `${grid.size}px ${grid.size}px`, backgroundPosition: `${Math.round(grid.x)}px ${Math.round(grid.y)}px` }
}

const HINT = 'Текст документа лежит на холсте карточкой: её можно двигать за верхнюю полоску. Фигуры и стикеры двигаются мышью, у выбранного можно поменять текст и цвет.'
const HINT_CONNECT = 'Режим стрелок: нажми два объекта подряд, чтобы соединить их. Повторное соединение той же пары убирает стрелку.'

/** Загруженный документ: сверху «Все документы», режим, звёздочка, «Удалить»; ниже страница или холст */
function LoadedDoc({ doc }: { doc: Doc }) {
  const { draft, state } = useDocDraft(doc)
  const presence = usePagePresence('doc', doc.id, draft, state)
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
  const pan = useRef<PanGrab | null>(null)
  const [panning, setPanning] = useState(false)
  // последнее положение указателя на экране и кадр автопрокрутки: холст едет сам, пока объект тащат у края окна
  const pointer = useRef<Point>({ x: 0, y: 0 })
  const frame = useRef<number | null>(null)
  // высота карточки с текстом зависит от текста: для «Показать всё» её берём с экрана, а пока её нет, как у миниатюры
  const noteRef = useRef<HTMLDivElement>(null)
  const { cvRef, cam, camRef, setCamera, viewSize, screenOf, zoomStep, resetZoom, showAll } = useCanvasView(edge, doc.id, () =>
    canvasBounds(canvas, noteRef.current?.offsetHeight ?? 150),
  )
  const selected = edge ? (canvas.objects.find((o) => o.id === sel) ?? null) : null

  // уходя из документа или выключив холст, останавливаем автопрокрутку
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

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

  /** Взять объект или карточку: запомнить, где угол относительно указателя, и захватить указатель */
  const startGrab = (e: PointerEvent<HTMLElement>, kind: Grab['kind'], id: string, x: number, y: number) => {
    pointer.current = { x: e.clientX, y: e.clientY }
    const at = toWorld(camRef.current, screenOf(e.clientX, e.clientY))
    grab.current = { kind, id, dx: x - at.x, dy: y - at.y, sx: e.clientX, sy: e.clientY, moved: false }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // захват не удался (указатель уже отпущен): объект всё равно выбран
    }
  }

  const itemDown = (id: string) => (e: PointerEvent<HTMLElement>) => {
    // средняя кнопка двигает холст (её ловит сам холст), правая ничего не тащит
    if (e.button !== 0) return
    if (connect) return link(id)
    const it = canvas.objects.find((o) => o.id === id)
    if (!it) return
    startGrab(e, 'item', id, it.x, it.y)
    if (sel !== id) setSel(id)
  }

  // с клавиатуры нажатие на объект приходит как click без указателя: выбирает объект или тянет стрелку
  const itemKey = (id: string) => (e: MouseEvent<HTMLElement>) => {
    if (e.detail !== 0) return
    if (connect) link(id)
    else setSel(id)
  }

  const noteDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    startGrab(e, 'note', doc.id, canvas.note.x, canvas.note.y)
    setSel(null)
    setFrom(null)
  }

  // Объект стоит там, где указатель, плюс прежнее расстояние до угла: считается в координатах холста, поэтому не зависит
  // от того, куда за это время сдвинулась камера. Во время движения меняется только локальное состояние, на сервер холст
  // уйдёт, когда указатель отпустят.
  const place = () => {
    const g = grab.current
    if (!g) return
    const at = toWorld(camRef.current, screenOf(pointer.current.x, pointer.current.y))
    const x = tidy(clampCoord(at.x + g.dx))
    const y = tidy(clampCoord(at.y + g.dy))
    cv.change((s) => (g.kind === 'note' ? moveNote(s, x, y) : patchObject(s, g.id, { x, y })), { save: false })
  }

  // Пока объект тащат у края окна, холст едет сам, а объект остаётся под указателем. Кадры идут, пока объект не отпустят.
  const startAutopan = () => {
    if (frame.current !== null) return
    let last: number | null = null // время прошлого кадра; у первого кадра шага нет
    const tick = (now: number) => {
      frame.current = null
      if (!grab.current) return
      const seconds = last === null ? 0 : Math.min(0.05, (now - last) / 1000)
      last = now
      const speed = edgeVelocity(screenOf(pointer.current.x, pointer.current.y), viewSize())
      if (speed.x !== 0 || speed.y !== 0) {
        setCamera(panBy(camRef.current, speed.x * seconds, speed.y * seconds))
        place()
      }
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }

  const move = (e: PointerEvent<HTMLElement>) => {
    const p = pan.current
    if (p) {
      setCamera({ ...p.cam, x: p.cam.x + e.clientX - p.sx, y: p.cam.y + e.clientY - p.sy })
      return
    }
    const g = grab.current
    if (!g) return
    pointer.current = { x: e.clientX, y: e.clientY }
    place()
    if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) >= DRAG_SLOP) {
      g.moved = true
      startAutopan()
    }
  }

  const release = () => {
    if (pan.current) {
      pan.current = null
      setPanning(false)
      return
    }
    if (!grab.current) return
    grab.current = null
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    cv.commit()
  }

  /** Пустое место или средняя кнопка берут холст целиком */
  const background = (e: PointerEvent<HTMLElement>) => {
    if (e.target === e.currentTarget) {
      setSel(null)
      setFrom(null)
    }
    if (!edge) return
    if (e.button === 1 || (e.button === 0 && e.target === e.currentTarget)) {
      pan.current = { sx: e.clientX, sy: e.clientY, cam: camRef.current }
      setPanning(true)
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // захват не удался: холст всё равно двигается, пока указатель над ним
      }
    }
  }

  // с клавиатуры (Tab) выбрали объект, которого сейчас не видно: холст сдвигается к нему на минимум
  const reveal = (e: FocusEvent<HTMLElement>) => {
    const el = e.target
    if (!(el instanceof HTMLElement) || !el.matches('.wb-item') || !el.matches(':focus-visible')) return
    const box = el.getBoundingClientRect()
    const at = screenOf(box.left, box.top)
    setCamera(revealCamera(camRef.current, { x: at.x, y: at.y, w: box.width, h: box.height }, viewSize()))
  }

  const add = (kind: ObjectKind) => {
    const object = newObject(canvas, kind, newId(), visibleRect(camRef.current, viewSize()))
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
          ref={cvRef}
          className={cx('cv', edge ? 'edge' : 'page', panning && 'panning')}
          style={edge ? gridBackground(cam) : undefined}
          onPointerDown={background}
          // средняя кнопка двигает холст, а не включает прокрутку страницы
          onMouseDown={(e) => {
            if (e.button === 1) e.preventDefault()
          }}
          onPointerMove={move}
          onPointerUp={release}
          onPointerCancel={release}
        >
          <div
            className="cv-world"
            style={edge ? { transform: `translate(${Math.round(cam.x)}px, ${Math.round(cam.y)}px) scale(${cam.z})` } : undefined}
            onFocus={edge ? reveal : undefined}
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
              ref={noteRef}
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
                marks={presence.marks}
                onActiveChange={presence.onActiveChange}
              />
            </div>
          </div>
        </div>
        {edge && (
          <div className="cv-zoom" role="group" aria-label="Масштаб холста">
            <Button aria-label="Уменьшить" title="Уменьшить" disabled={cam.z <= MIN_ZOOM} onClick={() => zoomStep(false)}>
              −
            </Button>
            <Button className="zoom-pct" aria-label={`Масштаб ${Math.round(cam.z * 100)}%, вернуть 100%`} title="Вернуть 100%" onClick={resetZoom}>
              {Math.round(cam.z * 100)}%
            </Button>
            <Button aria-label="Увеличить" title="Увеличить" disabled={cam.z >= MAX_ZOOM} onClick={() => zoomStep(true)}>
              +
            </Button>
            <Button onClick={showAll}>Показать всё</Button>
          </div>
        )}
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
