import { useState, type ChangeEvent, type KeyboardEvent } from 'react'

/** Черновик поля: правится локально, а на сервер уходит по blur или Enter, не на каждую букву */
export function useDraft(value: string) {
  const [state, setState] = useState({ value, draft: value })
  // значение пришло новое (сохранили, обновили с сервера): черновик начинается заново
  if (state.value !== value) setState({ value, draft: value })
  const setDraft = (draft: string) => setState((s) => ({ ...s, draft }))
  return [state.draft, setDraft] as const
}

type DraftFieldOptions = {
  /** Можно ли сохранить пустое значение (описание модуля — да, название — нет: тогда вернётся прежнее) */
  allowEmpty?: boolean
  /** Убирать пробелы по краям (для списка изменений релиза выключено) */
  trim?: boolean
}

/**
 * Поле с черновиком: `<input {...useDraftField(value, onCommit)} />`. Сохранение по blur; в однострочном поле
 * Enter работает как blur. `onCommit` вызывается, только если значение изменилось.
 */
export function useDraftField(value: string, onCommit: (next: string) => void, { allowEmpty = false, trim = true }: DraftFieldOptions = {}) {
  const [draft, setDraft] = useDraft(value)

  const commit = () => {
    const next = trim ? draft.trim() : draft
    if (!allowEmpty && !next.trim()) setDraft(value)
    else if (next !== value) onCommit(next)
    else if (draft !== next) setDraft(next) // убрали пробелы по краям, но значение прежнее
  }

  return {
    value: draft,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && e.currentTarget instanceof HTMLInputElement) e.currentTarget.blur()
    },
  }
}
