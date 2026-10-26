import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '../../components'
import { useSearch } from '../../lib/api/queries'
import { failed } from '../../lib/query'
import { useDebounced } from '../../lib/useDebounced'
import { useUi } from '../../lib/ui-store'
import { DialogFrame, Problem } from '../projects/parts'
import { emptyText, flatten, GROUPS, inGroup, moveActive } from './logic'
import { openItem } from './open'

/** Пауза после последней буквы, прежде чем спрашивать сервер */
const SEARCH_DELAY_MS = 200

/**
 * «Поиск» (Ctrl+K и пункт меню пользователя): названия задач и их id, документов, страниц вики и файлов. Стрелки двигают
 * выбор, Enter открывает, Esc закрывает. В макете такого окна нет, оно собрано из деталей окон проектов и поля поиска доски.
 */
export function SearchDialog() {
  const close = useUi((s) => s.closeProjectDialog)
  const listId = useId()
  const [typed, setTyped] = useState('')
  const query = useDebounced(typed.trim(), SEARCH_DELAY_MS)
  const search = useSearch(query)
  const [active, setActive] = useState(0)
  const rowsRef = useRef<HTMLDivElement>(null)

  // ответ показывается, пока человек не стёр запрос: прежний остаётся на месте, пока идёт новый
  const items = typed.trim() === '' || !search.data ? [] : flatten(search.data)
  const at = Math.min(active, Math.max(0, items.length - 1))

  // новый ответ: выбор снова на первой строке (состояние меняется при показе, а не в эффекте: так лишней отрисовки нет)
  const [seen, setSeen] = useState(search.data)
  if (seen !== search.data) {
    setSeen(search.data)
    setActive(0)
  }
  // выбранная строка не уходит за край прокручиваемого списка
  useEffect(() => {
    rowsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [at, items.length])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(moveActive(at, e.key === 'ArrowDown' ? 1 : -1, items.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[at]
      if (item) openItem(item)
    }
  }

  const open = items.length > 0
  const searching = typed.trim() !== query || search.isFetching
  return (
    <DialogFrame title="Поиск" narrow onClose={close}>
      <label className="search srch-box">
        <span className="sr">Поиск по названиям</span>
        <Icon name="search" />
        <input
          type="search"
          data-autofocus
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? `${listId}-${at}` : undefined}
          placeholder="Задачи, документы, вики, файлы"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </label>

      {failed(search) ? (
        <Problem>Не удалось выполнить поиск</Problem>
      ) : !open ? (
        <div className="empty srch-empty" aria-live="polite">
          {emptyText(typed, searching)}
        </div>
      ) : (
        <div ref={rowsRef} id={listId} className="srch-list" role="listbox" aria-label="Найденное" aria-busy={searching}>
          {GROUPS.map((group) => {
            const rows = inGroup(items, group.kind)
            if (rows.length === 0) return null
            return (
              <div key={group.kind} role="group" aria-label={group.title}>
                <div className="srch-group">{group.title}</div>
                {rows.map(({ item, index }) => (
                  <div
                    key={`${item.kind}:${item.id}`}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === at}
                    className={index === at ? 'srch-row on' : 'srch-row'}
                    onMouseMove={() => index !== at && setActive(index)}
                    onClick={() => openItem(item)}
                  >
                    <span className="srch-ic" aria-hidden="true">
                      <Icon name={item.icon} />
                    </span>
                    <span className="srch-main">
                      <span className="srch-title">
                        {item.key && <span className="mono">{item.key}</span>} {item.title}
                      </span>
                      <span className="srch-where">{item.where}</span>
                    </span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </DialogFrame>
  )
}
