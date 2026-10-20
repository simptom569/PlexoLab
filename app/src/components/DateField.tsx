import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type KeyboardEvent, type RefObject } from 'react'
import { cx } from '../lib/cx'
import { MONF, MONTHS_GEN, weekdays } from '../lib/date'
import { isIsoDate, moveCursor, pickerDays, addMonths } from '../lib/datePicker'
import { useDialogFocus } from '../lib/useDialogFocus'
import { useToday } from '../lib/useToday'
import { useUi } from '../lib/ui-store'
import { Button, IconButton } from './Button'
import { Icon } from './Icon'
import { Input } from './Fields'
import { Backdrop, Popover } from './Popover'

/** Зазор между полем и окном, он же отступ от края окна приложения (как у .pop: 8px) */
const GAP = 8

type PopupProps = {
  /** Поле, под которым встаёт окно */
  anchor: RefObject<HTMLElement | null>
  /** Кнопка-иконка: ей возвращается фокус при закрытии */
  opener: RefObject<HTMLElement | null>
  value: string
  clearable: boolean
  onPick: (value: string) => void
  onClose: () => void
}

/** Окно с сеткой месяца. position:fixed, поэтому его не обрезают .sheet и панели с overflow:hidden */
function DatePopup({ anchor, opener, value, clearable, onPick, onClose }: PopupProps) {
  const today = useToday()
  const weekStart = useUi((s) => s.weekStart)
  const selected = isIsoDate(value) ? value : ''
  // День, на котором стоит фокус (в сетке он один, остальные дни вне порядка Tab)
  const [cursor, setCursor] = useState(selected || today)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const moved = useRef(false)

  useDialogFocus(popRef, onClose, opener)

  // Окно идёт за полем, когда окно приложения меняет размер или прокручивается панель
  useLayoutEffect(() => {
    const place = () => {
      const field = anchor.current
      const pop = popRef.current
      if (!field || !pop) return
      const a = field.getBoundingClientRect()
      const w = pop.offsetWidth
      const h = pop.offsetHeight
      const below = a.bottom + GAP
      const above = a.top - GAP - h
      // Под полем, а если там тесно, то над ним; если тесно и там, то прижато к нижнему краю окна
      const top = below + h <= innerHeight - GAP ? below : above >= GAP ? above : Math.max(GAP, innerHeight - GAP - h)
      const left = Math.max(GAP, Math.min(a.left, innerWidth - GAP - w))
      setPos((p) => (p && p.top === top && p.left === left ? p : { top, left }))
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor])

  const focusCursor = useCallback(() => {
    popRef.current?.querySelector<HTMLElement>('[data-cursor]')?.focus({ preventScroll: true })
  }, [])
  useEffect(focusCursor, [focusCursor])
  // После стрелок фокус идёт за выбранным днём, после щелчка по кнопкам месяца остаётся на кнопке
  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    focusCursor()
  }, [cursor, focusCursor])

  const onGridKey = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const next = moveCursor(cursor, e.key, weekStart, e.shiftKey)
    if (!next) return
    e.preventDefault()
    moved.current = true
    setCursor(next)
  }

  const year = +cursor.slice(0, 4)
  const month = +cursor.slice(5, 7) - 1
  const days = pickerDays(year, month, weekStart)

  return (
    <>
      <Backdrop onClick={onClose} />
      <Popover
        ref={popRef}
        className="dp"
        aria-label="Выбор даты"
        tabIndex={-1}
        // До расчёта места окно невидимо, но не скрыто (visibility:hidden не принял бы фокус, который ставится при открытии)
        style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, opacity: pos ? undefined : 0 }}
      >
        <div className="dp-head">
          <IconButton icon="chevronLeft" label="Месяц назад" onClick={() => setCursor(addMonths(cursor, -1))} />
          <strong aria-live="polite">{`${MONF[month]} ${year}`}</strong>
          <IconButton icon="chevronRight" label="Месяц вперёд" onClick={() => setCursor(addMonths(cursor, 1))} />
        </div>
        <div role="grid" aria-label={`${MONF[month]} ${year}`} onKeyDown={onGridKey}>
          <div className="dp-row" role="row">
            {weekdays(weekStart).map((w) => (
              <div key={w} className="dp-wd" role="columnheader">
                {w}
              </div>
            ))}
          </div>
          {Array.from({ length: 6 }, (_, w) => (
            <div key={w} className="dp-row" role="row">
              {days.slice(w * 7, w * 7 + 7).map((day) => (
                <div key={day.date} role="gridcell" aria-selected={day.date === selected}>
                  <button
                    type="button"
                    className={cx('dp-day', !day.inMonth && 'out', day.date === today && 'today', day.date === selected && 'on')}
                    tabIndex={day.date === cursor ? 0 : -1}
                    data-cursor={day.date === cursor ? '' : undefined}
                    aria-label={`${day.num} ${MONTHS_GEN[+day.date.slice(5, 7) - 1]} ${day.date.slice(0, 4)}`}
                    aria-current={day.date === today ? 'date' : undefined}
                    onClick={() => onPick(day.date)}
                  >
                    {day.num}
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="dp-foot">
          <Button variant="ghost" onClick={() => onPick(today)}>
            Сегодня
          </Button>
          {clearable && selected && (
            <Button variant="ghost" onClick={() => onPick('')}>
              Очистить
            </Button>
          )}
        </div>
      </Popover>
    </>
  )
}

type DateFieldProps = Omit<ComponentProps<'input'>, 'type' | 'value' | 'onChange'> & {
  /** `ГГГГ-ММ-ДД` или пустая строка */
  value: string
  onChange: (value: string) => void
  /** В окне есть «Очистить»: для дат, которых может не быть */
  clearable?: boolean
}

/**
 * Поле с датой (.inp type="date") и своим календариком вместо окошка браузера, которое не поддаётся оформлению.
 * Ввод с клавиатуры по частям даты остаётся родным, значение то же `ГГГГ-ММ-ДД`.
 */
export function DateField({ value, onChange, clearable = false, style, ...rest }: DateFieldProps) {
  const [open, setOpen] = useState(false)
  const field = useRef<HTMLSpanElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])

  return (
    <span className="dp-field" ref={field}>
      <Input
        {...rest}
        type="date"
        value={value}
        style={{ ...style, paddingRight: 30 }}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          rest.onKeyDown?.(e)
          // Как у родного поля: Alt+↓ и F4 открывают календарик
          if ((e.altKey && e.key === 'ArrowDown') || e.key === 'F4') {
            e.preventDefault()
            setOpen(true)
          }
        }}
      />
      <button
        ref={opener}
        type="button"
        className="icon-btn dp-btn"
        aria-label="Открыть календарь"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="calendar" sm />
      </button>
      {open && (
        <DatePopup
          anchor={field}
          opener={opener}
          value={value}
          clearable={clearable}
          onPick={(next) => {
            onChange(next)
            close()
          }}
          onClose={close}
        />
      )}
    </span>
  )
}
