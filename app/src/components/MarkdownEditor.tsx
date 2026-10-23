import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import {
  TOOLS,
  append,
  describeBlock,
  finish,
  highlightCode,
  insertBlock,
  isMonoTool,
  keyAction,
  put,
  rowsFor,
  segments,
  toggleCheck,
  wrap,
  type Block,
  type BlockView,
  type CodeNode,
  type Edit,
  type Run,
  type Step,
} from '../lib/markdown'
import { cx } from '../lib/cx'
import { assignMarks, type PlacedMark } from '../lib/realtime/presence'
import { presenceClass } from '../lib/tones'
import { BlockMarks, PresenceSlot } from './PresenceMarks'
import { Tick } from './Tick'

type MarkdownEditorProps = {
  /** Весь текст одной строкой markdown */
  md: string
  /** Новый текст: на каждый символ и после каждой правки структуры. Сохранение с задержкой делает владелец. */
  onChange: (md: string) => void
  /** Названия страниц вики в нижнем регистре: ссылкам на несуществующие ставится пометка */
  wikiTitles: string[]
  /** Нажали на ссылку `[[...]]` */
  onOpenWiki: (title: string) => void
  /** Нажали на внешнюю ссылку (только http и https) */
  onOpenUrl: (url: string) => void
  /** Сразу открыть первый блок для ввода: новая пустая страница */
  autoEdit?: boolean
  /** Человек ушёл из блока (Esc, Ctrl+Enter, клик в сторону, переход в другой блок): владелец сохраняет без ожидания паузы */
  onFinish?: () => void
  /**
   * Открыть сразу этот блок (строки `[start, end)`) и поставить курсор в `caret` (позиция в тексте блока): так редактор
   * после слияния с чужой версией продолжает с того места, где человек печатал. Читается один раз, при показе.
   */
  restore?: ActiveBlock | null
  /** Владелец просит рассказать, какой блок открыт и где курсор: нужно в момент слияния. `null` — редактор закрыт. */
  registerProbe?: (probe: (() => ActiveBlock | null) | null) => void
  /** Где сейчас другие люди (строки показанного текста): рисуются полоской и ярлыком у блока. Нет в макете. */
  marks?: PlacedMark[]
  /** Какой блок открыт на правку сейчас (`null` — никакой): так остальным сообщается, где человек */
  onActiveChange?: (block: { start: number; end: number } | null) => void
}

/** Открытый блок: строки `[start, end)` и позиция курсора в его тексте */
export type ActiveBlock = { start: number; end: number; caret: number | null }

/** Активный блок и его «жетон»: растёт, когда активным становится другой блок */
type Active = Edit & { t: number }

type State = {
  edit: Active | null
  /** Где поставить курсор после отрисовки: число, `null` — в конец; сам объект нужен, чтобы новая просьба сработала снова */
  caret: { pos: number | null } | null
}

/** Редактор markdown в стиле Obsidian (vEditor, mdView и md* в макете). Логика клавиш и вставок лежит в `lib/markdown`. */
export function MarkdownEditor({ md, onChange, wikiTitles, onOpenWiki, onOpenUrl, autoEdit, onFinish, restore, registerProbe, marks, onActiveChange }: MarkdownEditorProps) {
  const [state, setState] = useState<State>(() =>
    restore
      ? { edit: { start: restore.start, end: restore.end, t: 1 }, caret: { pos: restore.caret } }
      : { edit: autoEdit ? { start: 0, end: 1, t: 1 } : null, caret: autoEdit ? { pos: 0 } : null },
  )
  const taRef = useRef<HTMLTextAreaElement>(null)
  // Актуальное значение «прямо сейчас»: обработчики событий иногда срабатывают раньше, чем React успеет отрисовать
  const mdRef = useRef(md)
  const editRef = useRef(state.edit)
  useLayoutEffect(() => {
    mdRef.current = md
    editRef.current = state.edit
  })

  // Слияние с чужой версией спрашивает, какой блок открыт и где курсор
  useEffect(() => {
    if (!registerProbe) return
    registerProbe(() => {
      const edit = editRef.current
      const el = taRef.current
      return edit ? { start: edit.start, end: edit.end, caret: el ? el.selectionStart : null } : null
    })
    return () => registerProbe(null)
  }, [registerProbe])

  // Курсор и фокус после того, как поле получило новый текст
  useLayoutEffect(() => {
    const el = taRef.current
    if (!state.caret || !el) return
    el.focus()
    const pos = state.caret.pos ?? el.value.length
    try {
      el.setSelectionRange(pos, pos)
    } catch {
      // поле ещё не принимает выделение: курсор остаётся там, где был
    }
  }, [state.caret])

  /** Применяет результат правки: текст, активный блок, курсор */
  const apply = (step: Step) => {
    const prev = editRef.current
    if (step.md !== mdRef.current) {
      mdRef.current = step.md
      onChange(step.md)
    }
    // другой блок стал активным — новый жетон, тот же блок растёт (ввод) — прежний
    const edit: Active | null = step.edit && { ...step.edit, t: prev && prev.start === step.edit.start ? prev.t : (prev?.t ?? 0) + 1 }
    editRef.current = edit
    setState({ edit, caret: step.caret === undefined ? null : { pos: step.caret } })
    // человек ушёл из блока: закончил правку или перешёл в соседний; написанное уходит на сервер, не дожидаясь паузы
    if (!edit || (prev && edit.t !== prev.t)) onFinish?.()
  }

  /** Блок стал активным по щелчку или клавише */
  const start = (seg: Block) => apply({ md: mdRef.current, edit: { start: seg.start, end: seg.end }, caret: null })

  /** Потеря фокуса завершает редактирование, но только если активным по-прежнему тот же блок (защита жетоном) */
  const blur = (token: number) => {
    const cur = editRef.current
    if (cur && cur.t === token) apply(finish(mdRef.current, cur))
  }

  const { segs, ed, lines } = segments(md, state.edit)
  // если активный блок вышел за пределы текста, `segments` его отбросил
  const edit = ed ? state.edit : null

  // Остальным сообщается, в каком блоке человек; закрыли редактор (ушли со страницы, текст заменили) — «ни в каком»
  const activeRef = useRef(onActiveChange)
  useLayoutEffect(() => {
    activeRef.current = onActiveChange
  })
  const activeStart = edit ? edit.start : -1
  const activeEnd = edit ? edit.end : -1
  useEffect(() => {
    activeRef.current?.(activeStart < 0 ? null : { start: activeStart, end: activeEnd })
  }, [activeStart, activeEnd])
  useEffect(() => () => activeRef.current?.(null), [])

  const { inBlock, inGap } = assignMarks(marks ?? [], segs)

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const cur = editRef.current
    if (!cur) return
    const el = e.currentTarget
    const result = keyAction(mdRef.current, cur, {
      key: e.key,
      shift: e.shiftKey,
      mod: e.ctrlKey || e.metaKey,
      value: el.value,
      selStart: el.selectionStart,
      selEnd: el.selectionEnd,
    })
    if (!result) return
    if (result.prevent) e.preventDefault()
    apply(result.step)
  }

  const runTool = (index: number) => {
    const tool = TOOLS[index]
    const cur = editRef.current
    if (tool.kind === 'insert') {
      apply(insertBlock(mdRef.current, cur && { start: cur.start, end: cur.end }, tool.text, tool.caret))
      return
    }
    const el = taRef.current
    if (!cur || !el) return
    const w = wrap(el.value, el.selectionStart, el.selectionEnd, tool.before, tool.after)
    apply(put(mdRef.current, cur, w.text, w.caret))
  }

  const isEmpty = !md.trim() && !edit
  const keepFocus = (e: MouseEvent) => e.preventDefault()

  return (
    <>
      <div className="md-bar" role="toolbar" aria-label="Форматирование">
        {TOOLS.map((tool, i) => (
          <ToolButton key={tool.label} index={i} onRun={runTool} onMouseDown={keepFocus} sep={!!tool.sep} />
        ))}
      </div>
      <div className="md">
        {segs.map((seg, i) => {
          const gap = inGap[i]!
          const here = inBlock[i]!
          const tone = here.length ? presenceClass(here[here.length - 1]!.tone) : undefined
          let block: ReactNode
          if (seg.kind === 'edit') {
            if (!edit) return null
            const text = lines.slice(seg.start, seg.end).join('\n')
            block = (
              <div className={cx(here.length > 0 && 'pm-mine', tone) || undefined}>
                {here.length > 0 && <BlockMarks marks={here} mine />}
                <textarea
                  ref={taRef}
                  className="md-ta"
                  data-autofocus="1"
                  rows={rowsFor(text)}
                  aria-label="Редактирование блока в markdown"
                  placeholder="Markdown: # заголовок, - список, - [ ] задача"
                  value={text}
                  onChange={(e) => apply(put(mdRef.current, edit, e.target.value))}
                  onKeyDown={onKeyDown}
                  onBlur={() => blur(edit.t)}
                />
              </div>
            )
          } else {
            block = (
              <div>
                <div
                  className={cx('mv', here.length > 0 && 'pm', tone)}
                  tabIndex={0}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    start(seg)
                  }}
                  onKeyDown={(e) => {
                    // Enter на самой плитке блока, а не на кнопке-галочке или ссылке внутри
                    if (e.key === 'Enter' && e.target === e.currentTarget) {
                      e.preventDefault()
                      start(seg)
                    }
                  }}
                >
                  {here.length > 0 && <BlockMarks marks={here} />}
                  <View
                    view={describeBlock(lines, seg, wikiTitles)}
                    onToggle={(line) => apply({ md: toggleCheck(mdRef.current, line), edit: editRef.current })}
                    onOpenWiki={onOpenWiki}
                    onOpenUrl={onOpenUrl}
                  />
                </div>
              </div>
            )
          }
          return (
            <Fragment key={i}>
              {gap.length > 0 && <PresenceSlot marks={gap} />}
              {block}
            </Fragment>
          )
        })}
        {inGap[segs.length]!.length > 0 && <PresenceSlot marks={inGap[segs.length]!} />}
        <div
          className={cx('md-add', isEmpty && 'empty')}
          role="button"
          tabIndex={0}
          onMouseDown={(e) => {
            e.preventDefault()
            apply(append(mdRef.current))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              apply(append(mdRef.current))
            }
          }}
        >
          {isEmpty ? 'Нажми, чтобы начать писать' : '+ Добавить блок'}
        </div>
      </div>
    </>
  )
}

function ToolButton({ index, onRun, onMouseDown, sep }: { index: number; onRun: (index: number) => void; onMouseDown: (e: MouseEvent) => void; sep: boolean }) {
  const tool = TOOLS[index]
  return (
    <>
      <button
        className={cx('md-tool', isMonoTool(tool.label) && 'mono')}
        type="button"
        title={tool.title}
        aria-label={tool.title}
        onMouseDown={onMouseDown}
        onClick={() => onRun(index)}
      >
        {tool.label}
      </button>
      {sep ? <span className="md-sep" aria-hidden="true" /> : null}
    </>
  )
}

type ViewProps = {
  view: BlockView
  onToggle: (line: number) => void
  onOpenWiki: (title: string) => void
  onOpenUrl: (url: string) => void
}

function Runs({ runs, onOpenWiki, onOpenUrl }: { runs: Run[] } & Pick<ViewProps, 'onOpenWiki' | 'onOpenUrl'>) {
  return (
    <>
      {runs.map((r, i) => {
        const link = !!(r.wiki || r.url)
        return (
          <span
            key={i}
            className={cx('il', r.cls)}
            // клик по ссылке не должен делать блок активным
            onMouseDown={link ? (e) => e.stopPropagation() : undefined}
            onClick={
              r.wiki
                ? (e) => {
                    e.stopPropagation()
                    onOpenWiki(r.wiki!)
                  }
                : r.url
                  ? (e) => {
                      e.stopPropagation()
                      if (/^https?:/i.test(r.url!)) onOpenUrl(r.url!)
                    }
                  : undefined
            }
          >
            {r.t}
          </span>
        )
      })}
    </>
  )
}

function CodeNodes({ nodes }: { nodes: CodeNode[] }) {
  return (
    <>
      {nodes.map((n, i) =>
        typeof n === 'string' ? (
          n
        ) : (
          <span key={i} className={n.cls}>
            <CodeNodes nodes={n.nodes} />
          </span>
        ),
      )}
    </>
  )
}

/** Текст блока кода: цветной, если язык известен, иначе как есть */
function CodeText({ code, lang }: { code: string; lang: string }) {
  const nodes = useMemo(() => highlightCode(code, lang), [code, lang])
  return nodes ? <CodeNodes nodes={nodes} /> : code
}

/** Отрисованный вид блока */
function View({ view, onToggle, onOpenWiki, onOpenUrl }: ViewProps) {
  const links = { onOpenWiki, onOpenUrl }
  switch (view.kind) {
    case 'text':
      return (
        <div className={cx('mt', view.cls)}>
          {view.title !== undefined ? <div className="co-title">{view.title}</div> : null}
          {view.lines.map((runs, i) => (
            <div key={i} className="ln">
              <Runs runs={runs} {...links} />
            </div>
          ))}
        </div>
      )
    case 'list':
      return (
        <div>
          {view.items.map((it) => (
            <div key={it.line} className="li" style={{ paddingLeft: it.pad }}>
              {it.isCheck ? (
                <Tick
                  done={it.done}
                  label="Отметить пункт"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => onToggle(it.line)}
                />
              ) : (
                <span className="li-dot" aria-hidden="true">
                  {it.dot}
                </span>
              )}
              <div className={cx('li-t', it.done && 'done')}>
                <Runs runs={it.runs} {...links} />
              </div>
            </div>
          ))}
        </div>
      )
    case 'code':
      return (
        <pre className="md-code">
          {view.lang ? <span className="md-lang">{view.lang}</span> : null}
          <code>
            <CodeText code={view.code} lang={view.lang} />
          </code>
        </pre>
      )
    case 'hr':
      return <hr className="md-hr" />
    case 'table':
      return (
        <div className="md-tbl">
          <div className="md-grid" style={{ gridTemplateColumns: `repeat(${view.cols},minmax(110px,1fr))` }}>
            {view.cells.map((cell, i) => (
              <div
                key={i}
                className={cx('md-cell', cell.head && 'head', i % view.cols === view.cols - 1 && 'last-col', i >= view.cells.length - view.cols && 'last-row')}
              >
                <Runs runs={cell.runs} {...links} />
              </div>
            ))}
          </div>
        </div>
      )
  }
}
