import { useState } from 'react'
import { Button, Input } from '../../components'
import {
  PROJECT_COLORS,
  PROJECT_NAME_MAX,
  isValidKey,
  normalizeKey,
  type ProjectDialog,
} from '../../lib/project-dialogs'
import { useUi } from '../../lib/ui-store'
import { createProject, errorText } from './api'
import { DialogFrame, Field, Problem } from './parts'

type Props = { dialog: Extract<ProjectDialog, { kind: 'new' }> }

/** «Новый проект»: название, цвет и необязательный ключ id задач. Создатель становится администратором. */
export function NewProjectDialog(_props: Props) {
  const close = useUi((s) => s.closeProjectDialog)
  const setProject = useUi((s) => s.setProject)
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(PROJECT_COLORS[0].value)
  const [key, setKey] = useState('')
  const [state, setState] = useState<{ saving: boolean; error: string | null }>({ saving: false, error: null })

  const cleanKey = normalizeKey(key)
  const keyOk = isValidKey(cleanKey)
  const canCreate = name.trim() !== '' && keyOk && !state.saving

  const submit = async () => {
    if (!canCreate) return
    setState({ saving: true, error: null })
    try {
      const project = await createProject({ name: name.trim(), color, key: cleanKey })
      setProject(project.id)
      close()
    } catch (e) {
      setState({ saving: false, error: errorText(e) })
    }
  }

  return (
    <DialogFrame title="Новый проект" narrow onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="fields">
          <Field label="Название" htmlFor="np-name">
            <Input
              id="np-name"
              autoFocus
              maxLength={PROJECT_NAME_MAX}
              style={{ flex: '1 1 220px' }}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="f-row">
            <span className="f-label" id="np-color-label">
              Цвет
            </span>
            <div className="f-val" role="group" aria-labelledby="np-color-label" style={{ gap: 8, paddingTop: 6 }}>
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c.value}
                  className={c.value === color ? 'sw-btn on' : 'sw-btn'}
                  type="button"
                  aria-label={c.name}
                  aria-pressed={c.value === color}
                  style={{ background: `var(--${c.value})` }}
                  onClick={() => setColor(c.value)}
                />
              ))}
            </div>
          </div>
          <Field label="Ключ задач" htmlFor="np-key">
            <Input
              id="np-key"
              maxLength={6}
              placeholder="Необязательно"
              style={{ flex: '0 1 160px' }}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              aria-describedby="np-key-hint"
              aria-invalid={!keyOk}
            />
            <span id="np-key-hint" className="set-desc" style={{ margin: 0, flexBasis: '100%' }}>
              2–6 символов, латиница и цифры. Задачи получат номера вида {keyOk && cleanKey ? cleanKey : 'PLX'}-1, без ключа TASK-1.
            </span>
          </Field>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 16 }}>
          {!keyOk && <Problem>Ключ: от 2 до 6 символов, латиница и цифры, начинается с буквы</Problem>}
          {state.error && <Problem>{state.error}</Problem>}
          <Button variant="ghost" onClick={close}>
            Отмена
          </Button>
          <Button write variant="primary" type="submit" disabled={!canCreate}>
            Создать
          </Button>
        </div>
      </form>
    </DialogFrame>
  )
}
