import { useState } from 'react'
import { Button, Input, Segmented } from '../../components'
import {
  PROJECT_COLORS,
  PROJECT_NAME_MAX,
  isValidKey,
  normalizeKey,
  type ProjectDialog,
} from '../../lib/project-dialogs'
import { canCreateProject, useCurrentTeamInfo } from '../../lib/team'
import { VISIBILITY_LABELS, type Visibility } from '../../lib/team-dialogs'
import { useUi } from '../../lib/ui-store'
import { createProject, errorText } from './api'
import { DialogFrame, Field, Problem } from './parts'

type Props = { dialog: Extract<ProjectDialog, { kind: 'new' }> }

const VISIBILITY_OPTIONS = [
  { value: 'members', label: VISIBILITY_LABELS.members },
  { value: 'team', label: VISIBILITY_LABELS.team },
] as const

/**
 * «Новый проект»: название, цвет, необязательный ключ id задач и видимость (кто видит проект, кроме приглашённых). Проект
 * создаётся в текущей команде. Создатель становится администратором.
 */
export function NewProjectDialog(_props: Props) {
  const close = useUi((s) => s.closeProjectDialog)
  const setProject = useUi((s) => s.setProject)
  const team = useCurrentTeamInfo()
  const [visibility, setVisibility] = useState<Visibility>('members')
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(PROJECT_COLORS[0].value)
  const [key, setKey] = useState('')
  const [state, setState] = useState<{ saving: boolean; error: string | null }>({ saving: false, error: null })

  const cleanKey = normalizeKey(key)
  const keyOk = isValidKey(cleanKey)
  const canCreate = name.trim() !== '' && keyOk && canCreateProject(team) && !state.saving

  const submit = async () => {
    if (!canCreate || team === null) return
    setState({ saving: true, error: null })
    try {
      const project = await createProject({ team_id: team.id, name: name.trim(), color, key: cleanKey, visibility })
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
          <div className="f-row">
            <span className="f-label" id="np-vis-label">
              Видимость
            </span>
            <div className="f-val" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
              <Segmented write label="Видимость проекта" options={VISIBILITY_OPTIONS} value={visibility} onChange={setVisibility} />
              <span className="set-desc" style={{ margin: 0 }}>
                {visibility === 'members'
                  ? 'Проект видят приглашённые в него и администраторы команды.'
                  : 'Проект видят все члены команды и приглашённые в него.'}
              </span>
            </div>
          </div>
          <div className="f-row">
            <span className="f-label">Команда</span>
            <div className="f-val">
              <strong>{team?.name ?? ''}</strong>
            </div>
          </div>
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
