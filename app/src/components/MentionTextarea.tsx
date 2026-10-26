import { useId, useLayoutEffect, useRef, useState, type ComponentProps, type KeyboardEvent } from 'react'
import { activeMention, filterMentionable, insertMention, type Mentionable } from '../lib/mentions'
import { Avatar } from './Avatar'
import { Textarea } from './Fields'
import { Anchor, Opt, Popover } from './Popover'

type Props = Omit<ComponentProps<'textarea'>, 'value' | 'onChange'> & {
  value: string
  onChange: (text: string) => void
  /** Кого можно упомянуть (участники проекта, кроме самого пишущего) */
  people: Array<Mentionable & { tone?: number }>
  /** Человек выбран в списке: в тексте стоит его `@Имя`, при отправке оно станет меткой (`toWire`) */
  onPick: (person: Mentionable) => void
}

/**
 * Поле комментария, в котором по `@` открывается список участников проекта (docs/OFFLINE-NOTIFY-SEARCH.md, раздел 2).
 * Набираешь `@` и начало имени, выбираешь стрелками и Enter (или Tab, или нажатием), и в тексте появляется `@Имя`.
 * Esc закрывает список, не трогая текст. Поле остаётся текстовым (`textbox`), список связан с ним через `aria-controls` и
 * `aria-activedescendant`. В макете такого поля нет, список собран из `.pop` и `.opt`.
 */
export function MentionTextarea({ value, onChange, people, onPick, onKeyDown, onBlur, onFocus, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const listId = useId()
  const [caret, setCaret] = useState(0)
  const [focused, setFocused] = useState(false)
  const [highlight, setHighlight] = useState(0)
  // `@`, у которой человек закрыл список клавишей Esc: пока он не поставит другую, список не показывается
  const [closedAt, setClosedAt] = useState<number | null>(null)
  // куда поставить курсор после того, как поле получит текст с вставленным именем
  const pendingCaret = useRef<number | null>(null)
  useLayoutEffect(() => {
    const at = pendingCaret.current
    if (at === null || !ref.current) return
    pendingCaret.current = null
    ref.current.setSelectionRange(at, at)
  })

  const mention = focused ? activeMention(value, caret) : null
  const options = mention && closedAt !== mention.at ? filterMentionable(people, mention.query) : []
  const open = options.length > 0

  const choose = (person: Mentionable) => {
    if (!mention) return
    const next = insertMention(value, mention, caret, person.name)
    onChange(next.text)
    onPick({ id: person.id, name: person.name })
    setCaret(next.caret)
    // курсор встаёт после вставленного имени сразу, как только поле получило новый текст, а не в следующем кадре:
    // иначе быстро набранное сразу после выбора перемешалось бы
    pendingCaret.current = next.caret
  }

  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(e)
    if (!open || e.defaultPrevented) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setHighlight((h) => (h + step + options.length) % options.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      choose(options[Math.min(highlight, options.length - 1)]!)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setClosedAt(mention!.at)
    }
  }

  const active = Math.min(highlight, Math.max(0, options.length - 1))
  return (
    <Anchor style={{ display: 'flex', flexDirection: 'column' }}>
      <Textarea
        {...rest}
        ref={ref}
        value={value}
        // остаётся обычным текстовым полем (многострочным): роль «combobox» ему не подходит, а подсказки списка передают
        // aria-autocomplete, aria-controls и aria-activedescendant
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onChange={(e) => {
          onChange(e.target.value)
          setCaret(e.target.selectionStart)
          setHighlight(0)
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={keys}
        onFocus={(e) => {
          setFocused(true)
          setCaret(e.currentTarget.selectionStart)
          onFocus?.(e)
        }}
        onBlur={(e) => {
          setFocused(false)
          onBlur?.(e)
        }}
      />
      {open && (
        <Popover small role="listbox" id={listId} aria-label="Кого упомянуть" style={{ top: 'auto', bottom: 'calc(100% + 6px)', left: 0, minWidth: 220 }}>
          {options.map((p, i) => (
            <Opt
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'on' : undefined}
              // нажатие не должно снимать фокус с поля: иначе список закроется раньше, чем выбор сработает
              onMouseDown={(e) => {
                e.preventDefault()
                choose(p)
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              <Avatar name={p.name} tone={p.tone} size="sm" decorative />
              {p.name}
            </Opt>
          ))}
        </Popover>
      )}
    </Anchor>
  )
}
