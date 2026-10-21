import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { Anchor, Backdrop, MenuItem, Popover } from './Popover'

type Person = { id: string; name: string; tone: number }

type Props = {
  /** Выбранный человек; null — никто */
  value: string | null
  /** Кого можно выбрать (выбранный должен быть среди них, иначе кнопка покажет «никто») */
  people: Person[]
  /** Подпись, когда никого нет: «Не назначен» */
  noneLabel: string
  /** Название списка для скринридера */
  label: string
  /** Подсказка кнопки */
  title?: string
  onChange: (id: string | null) => void
}

/**
 * Выбор человека из раскрывающегося списка в стиле меню сайта: кнопка с аватаром и именем (.opt), под ней список
 * (.pop.sm) с пунктом «никто» и людьми. Стрелки двигают по списку, Enter выбирает, Esc закрывает и возвращает фокус
 * на кнопку, клик мимо закрывает.
 */
export function PersonSelect({ value, people, noneLabel, label, title, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const current = people.find((p) => p.id === value) ?? null

  const items = () => [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])]

  // при открытии фокус уходит в список: на выбранного, а если никого нет, на первый пункт
  useEffect(() => {
    if (!open) return
    const all = items()
    ;(all.find((el) => el.getAttribute('aria-checked') === 'true') ?? all[0])?.focus()
  }, [open])

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }

  const pick = (id: string | null) => {
    close(true)
    if (id !== value) onChange(id)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = items()
    const at = all.indexOf(document.activeElement as HTMLElement)
    const go = (index: number) => {
      e.preventDefault()
      all[(index + all.length) % all.length]?.focus()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close(true)
    } else if (e.key === 'ArrowDown') go(at + 1)
    else if (e.key === 'ArrowUp') go(at - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(all.length - 1)
    else if (e.key === 'Tab') close(false)
  }

  return (
    <Anchor style={{ display: 'flex' }}>
      <button
        ref={trigger}
        className="opt"
        type="button"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar name={current?.name ?? null} tone={current?.tone} size="sm" decorative />
        {current?.name ?? noneLabel}
      </button>
      {open && (
        <>
          <Backdrop onClick={() => close(false)} />
          <Popover small ref={list} role="menu" aria-label={label} onKeyDown={onKeyDown}>
            <MenuItem role="menuitemradio" aria-checked={value === null} onClick={() => pick(null)}>
              <Avatar name={null} size="sm" decorative />
              {noneLabel}
              {value === null && (
                <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>
                  <Icon name="check" sm />
                </span>
              )}
            </MenuItem>
            {people.map((p) => (
              <MenuItem key={p.id} role="menuitemradio" aria-checked={p.id === value} onClick={() => pick(p.id)}>
                <Avatar name={p.name} tone={p.tone} size="sm" decorative />
                {p.name}
                {p.id === value && (
                  <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>
                    <Icon name="check" sm />
                  </span>
                )}
              </MenuItem>
            ))}
          </Popover>
        </>
      )}
    </Anchor>
  )
}
