import { useEffect, useState } from 'react'
import { Avatar, Button, Input, Segmented, Switch } from '../../components'
import { useTeamMembers } from '../../lib/api/queries'
import type { Team, TeamMember } from '../../lib/api/types'
import { ROLE_LABELS, roleOf, type ProjectRole } from '../../lib/project-dialogs'
import { useReadOnly } from '../../lib/link'
import { useSession } from '../../lib/session'
import { canManageTeam, useCurrentTeamInfo } from '../../lib/team'
import { TEAM_NAME_MAX, TEAM_TAB_LABELS, type TeamTab } from '../../lib/team-dialogs'
import type { ProjectDialog } from '../../lib/project-dialogs'
import { useUi } from '../../lib/ui-store'
import { DialogFrame, Field, Problem, RowProblem, TwoStep, type FrameTab } from '../projects/parts'
import { useAttempt } from '../projects/useAttempt'
import { archiveTeam, errorText, inviteToTeam, removeTeamMember, revokeTeamInvite, setTeamMemberRole, updateTeam } from './api'

const ROLE_OPTIONS = [
  { value: 'member', label: ROLE_LABELS.member },
  { value: 'admin', label: ROLE_LABELS.admin },
] as const

const TAB_ICONS = { main: 'sliders', members: 'user', archive: 'folder' } as const

/** «Настройки команды» (для администратора): основное, участники, архив. У «Личного» архива нет. */
export function TeamSettingsDialog({ dialog }: { dialog: Extract<ProjectDialog, { kind: 'team-settings' }> }) {
  const close = useUi((s) => s.closeProjectDialog)
  const setTab = useUi((s) => s.setTeamTab)
  const team = useCurrentTeamInfo()
  const serverAdmin = useSession((s) => s.user?.is_admin ?? false)
  const manage = canManageTeam(team, serverAdmin)

  // команда сменилась, её заархивировали или права пропали: окно закрывается
  const gone = !team || team.id !== dialog.id || !manage
  useEffect(() => {
    if (gone) close()
  }, [gone, close])
  if (!team || gone) return null

  const tabs: ReadonlyArray<FrameTab<TeamTab>> = [
    { id: 'main', label: TEAM_TAB_LABELS.main, icon: TAB_ICONS.main },
    { id: 'members', label: TEAM_TAB_LABELS.members, icon: TAB_ICONS.members },
    ...(team.personal ? [] : [{ id: 'archive' as const, label: TEAM_TAB_LABELS.archive, icon: TAB_ICONS.archive }]),
  ]
  const current = tabs.some((t) => t.id === dialog.tab) ? dialog.tab : 'main'

  return (
    <DialogFrame
      title={`Настройки команды «${team.name}»`}
      onClose={close}
      tabs={{ items: tabs, current, onSelect: setTab, navTitle: team.name }}
    >
      {current === 'main' && <MainTab team={team} />}
      {current === 'members' && <MembersTab team={team} />}
      {current === 'archive' && <ArchiveTab team={team} />}
    </DialogFrame>
  )
}

function MainTab({ team }: { team: Team }) {
  const readOnly = useReadOnly()
  const [name, setName] = useState(team.name)
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; text: string }>({ kind: 'idle' })
  const [guestsRead, setGuestsRead] = useState(team.guests_read_wiki ?? false)
  const [switchProblem, setSwitchProblem] = useState<string | null>(null)

  const canSave = name.trim() !== '' && name.trim() !== team.name && state.kind !== 'saving'

  const save = async () => {
    setState({ kind: 'saving' })
    try {
      const saved = await updateTeam(team.id, { name: name.trim() })
      setName(saved.name)
      setState({ kind: 'saved' })
    } catch (e) {
      setState({ kind: 'error', text: errorText(e) })
    }
  }

  const toggleGuests = async (next: boolean) => {
    setSwitchProblem(null)
    setGuestsRead(next)
    try {
      await updateTeam(team.id, { guests_read_wiki: next })
    } catch (e) {
      setGuestsRead(!next)
      setSwitchProblem(errorText(e))
    }
  }

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="fields">
          <Field label="Название" htmlFor="ts-name">
            <Input
              id="ts-name"
              maxLength={TEAM_NAME_MAX}
              style={{ flex: '1 1 220px', maxWidth: 360 }}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setState({ kind: 'idle' })
              }}
            />
          </Field>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 16 }}>
          {state.kind === 'saved' && (
            <span role="status" className="set-desc" style={{ margin: 0 }}>
              Сохранено
            </span>
          )}
          {state.kind === 'error' && <Problem>{state.text}</Problem>}
          <Button write variant="primary" type="submit" disabled={!canSave}>
            Сохранить
          </Button>
        </div>
      </form>
      <section>
        <div className="set-list">
          <div className="set-row">
            <div className="set-text">
              <div className="set-label" id="ts-guests-label">
                Гости проектов могут читать вики команды
              </div>
              <div className="set-desc">
                Гость — тот, кого позвали в проект команды, а в саму команду нет. Он сможет читать вики и скачивать файлы библиотеки,
                но не править их. По умолчанию выключено.
              </div>
            </div>
            <div className="set-ctl">
              <Switch label="Гости проектов могут читать вики команды" checked={guestsRead} disabled={readOnly} onChange={(next) => void toggleGuests(next)} />
            </div>
          </div>
        </div>
        {switchProblem && <Problem>{switchProblem}</Problem>}
      </section>
    </>
  )
}

/** «Участники» команды: кто в ней и с какой ролью, кого позвали, приглашение по e-mail */
function MembersTab({ team }: { team: Team }) {
  const me = useSession((s) => s.user)
  const members = useTeamMembers(team.id)
  const attempt = useAttempt()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ProjectRole>('member')
  const [inviting, setInviting] = useState(false)
  const [sent, setSent] = useState<string | null>(null)

  const invite = async () => {
    const address = email.trim()
    if (!address) return
    setInviting(true)
    setSent(null)
    await attempt.run(async () => {
      await inviteToTeam(team.id, address, role)
      setEmail('')
      setSent(address)
    })
    setInviting(false)
  }

  if (members.isPending) return <div className="empty">Загружаю…</div>
  if (!members.data) return <Problem>Не удалось загрузить участников</Problem>

  return (
    <>
      <section>
        <h3 className="sec-title">В команде</h3>
        <div className="proj-rows" aria-label="Участники команды">
          {members.data.members.map((m) => (
            <MemberRow key={m.user_id} member={m} itsMe={m.user_id === me?.id} teamId={team.id} />
          ))}
        </div>
        <p className="set-desc" style={{ margin: '8px 0 0' }}>
          Администраторы команды видят все её проекты и могут ими управлять.
        </p>
      </section>

      {members.data.invites.length > 0 && (
        <section>
          <h3 className="sec-title">Ожидают ответа</h3>
          <div className="proj-rows" aria-label="Приглашения в команду, на которые ещё не ответили">
            {members.data.invites.map((i) => (
              <InviteRow key={i.id} invite={i} teamId={team.id} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="sec-title">Пригласить</h3>
        <form
          className="fields"
          onSubmit={(e) => {
            e.preventDefault()
            void invite()
          }}
        >
          <div className="f-row">
            <label className="f-label" htmlFor="tinv-email">
              E-mail
            </label>
            <div className="f-val">
              <Input
                id="tinv-email"
                type="email"
                autoComplete="off"
                placeholder="адрес существующего аккаунта"
                style={{ flex: '1 1 240px' }}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setSent(null)
                  attempt.clear()
                }}
              />
            </div>
          </div>
          <div className="f-row">
            <span className="f-label">Роль</span>
            <div className="f-val">
              <Segmented write label="Роль приглашённого" options={ROLE_OPTIONS} value={role} onChange={setRole} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
            {attempt.problem && <Problem>{attempt.problem}</Problem>}
            {sent && (
              <span role="status" className="set-desc" style={{ margin: 0 }}>
                Приглашение отправлено: {sent}
              </span>
            )}
            <Button write variant="primary" type="submit" disabled={inviting || email.trim() === ''}>
              Пригласить
            </Button>
          </div>
        </form>
      </section>
    </>
  )
}

function MemberRow({ member, itsMe, teamId }: { member: TeamMember; itsMe: boolean; teamId: string }) {
  const role = roleOf(member.role)
  const { problem, run } = useAttempt()
  return (
    <>
      <div className="proj-row">
        <div className="proj-person">
          <Avatar name={member.name} tone={member.tone} decorative />
          <span>
            <strong>
              {member.name}
              {itsMe ? ' (вы)' : ''}
            </strong>
            <small>{member.email || member.job}</small>
          </span>
        </div>
        <div className="proj-actions">
          {/* свою роль здесь не меняем: выйти можно из меню команды, а понизив себя человек закрыл бы это окно */}
          {itsMe ? (
            <span className="set-desc" style={{ margin: 0 }}>
              {ROLE_LABELS[role]}
            </span>
          ) : (
            <Segmented
              write
              label={`Роль: ${member.name}`}
              options={ROLE_OPTIONS}
              value={role}
              onChange={(next) => void run(() => setTeamMemberRole(teamId, member.user_id, next))}
            />
          )}
          {!itsMe && (
            <TwoStep
              id={`team-member:${member.user_id}`}
              label="Убрать"
              confirmLabel="Точно убрать?"
              onConfirm={() => void run(() => removeTeamMember(teamId, member.user_id))}
            />
          )}
        </div>
      </div>
      {problem && <RowProblem>{problem}</RowProblem>}
    </>
  )
}

function InviteRow({
  invite,
  teamId,
}: {
  invite: { id: string; name: string; tone: number; email: string; role: string; registered: boolean }
  teamId: string
}) {
  const { problem, run } = useAttempt()
  return (
    <>
      <div className="proj-row">
        <div className="proj-person">
          <Avatar name={invite.name} tone={invite.tone} decorative />
          <span>
            <strong>{invite.name}</strong>
            <small>
              {invite.registered ? `${invite.email} · ${ROLE_LABELS[roleOf(invite.role)]} · ожидает ответа` : `${ROLE_LABELS[roleOf(invite.role)]} · ждёт регистрации`}
            </small>
          </span>
        </div>
        <div className="proj-actions">
          <Button write variant="ghost" onClick={() => void run(() => revokeTeamInvite(teamId, invite.id))}>
            Отозвать
          </Button>
        </div>
      </div>
      {problem && <RowProblem>{problem}</RowProblem>}
    </>
  )
}

function ArchiveTab({ team }: { team: Team }) {
  const close = useUi((s) => s.closeProjectDialog)
  const [problem, setProblem] = useState<string | null>(null)

  const archive = async () => {
    setProblem(null)
    try {
      await archiveTeam(team.id)
      close()
      // команды больше нет в списках: выбор сбрасывается, на экране «Личное» (администратор сервера иначе остался бы в ней как в чужой)
      useUi.setState({ team: null, project: null })
    } catch (e) {
      setProblem(errorText(e))
    }
  }

  return (
    <section>
      <div className="set-list">
        <div className="set-row">
          <div className="set-text">
            <div className="set-label">Архивировать команду</div>
            <div className="set-desc">
              Команда исчезнет из переключателя вместе с проектами, вики и файлами; гостям её проекты тоже перестанут открываться. Ничего
              не удаляется: вернуть команду можно в окне «Архив проектов» в меню пользователя.
            </div>
          </div>
          <div className="set-ctl">
            <TwoStep id={`team-archive:${team.id}`} variant="default" label="Архивировать" confirmLabel="Точно архивировать?" onConfirm={() => void archive()} />
          </div>
        </div>
      </div>
      {problem && <Problem>{problem}</Problem>}
    </section>
  )
}
