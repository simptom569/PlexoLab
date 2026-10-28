import { useState } from 'react'
import { Button, Input } from '../../components'
import { TEAM_NAME_MAX } from '../../lib/team-dialogs'
import { useUi } from '../../lib/ui-store'
import { DialogFrame, Field, Problem } from '../projects/parts'
import { createTeam, errorText } from './api'

/** «Новая команда»: название. Создатель становится администратором и сразу переходит в неё. */
export function NewTeamDialog() {
  const close = useUi((s) => s.closeProjectDialog)
  const setTeam = useUi((s) => s.setTeam)
  const [name, setName] = useState('')
  const [state, setState] = useState<{ saving: boolean; error: string | null }>({ saving: false, error: null })
  const canCreate = name.trim() !== '' && !state.saving

  const submit = async () => {
    if (!canCreate) return
    setState({ saving: true, error: null })
    try {
      const team = await createTeam(name.trim())
      close()
      setTeam(team.id)
    } catch (e) {
      setState({ saving: false, error: errorText(e) })
    }
  }

  return (
    <DialogFrame title="Новая команда" narrow onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="fields">
          <Field label="Название" htmlFor="nt-name">
            <Input
              id="nt-name"
              autoFocus
              maxLength={TEAM_NAME_MAX}
              style={{ flex: '1 1 220px' }}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setState((s) => ({ ...s, error: null }))
              }}
            />
          </Field>
        </div>
        <p className="set-desc" style={{ margin: '12px 0 0' }}>
          У команды будут свои проекты, общая вики и библиотека файлов. Людей в неё можно позвать по e-mail в настройках команды.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 16 }}>
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
