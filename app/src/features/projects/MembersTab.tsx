import { useState } from 'react'
import { Avatar, Button, Input, Segmented } from '../../components'
import { useMembers } from '../../lib/api/queries'
import type { Member, PendingInvite } from '../../lib/api/types'
import { ROLE_LABELS, roleOf, type ProjectRole } from '../../lib/project-dialogs'
import { useSession } from '../../lib/session'
import { errorText, inviteMember, removeMember, revokeInvite, setMemberRole } from './api'
import { Problem, TwoStep } from './parts'

const ROLE_OPTIONS = [
  { value: 'member', label: ROLE_LABELS.member },
  { value: 'admin', label: ROLE_LABELS.admin },
] as const

/** «Участники»: кто в проекте и с какой ролью, кого позвали и ещё нет ответа, приглашение по e-mail */
export function MembersTab({ projectId }: { projectId: string }) {
  const me = useSession((s) => s.user)
  const members = useMembers(projectId)
  const [problem, setProblem] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ProjectRole>('member')
  const [inviting, setInviting] = useState(false)
  const [sent, setSent] = useState<string | null>(null)

  const act = async (work: () => Promise<void>) => {
    setProblem(null)
    try {
      await work()
    } catch (e) {
      setProblem(errorText(e))
    }
  }

  const invite = async () => {
    const address = email.trim()
    if (!address) return
    setInviting(true)
    setSent(null)
    await act(async () => {
      await inviteMember(projectId, address, role)
      setEmail('')
      setSent(address)
    })
    setInviting(false)
  }

  if (members.isPending) return <div className="empty">Загружаю…</div>
  if (members.isError || !members.data) return <Problem>Не удалось загрузить участников</Problem>

  return (
    <>
      <section>
        <h3 className="sec-title">В проекте</h3>
        <div className="proj-rows" aria-label="Участники проекта">
          {members.data.members.map((m) => (
            <MemberRow key={m.user_id} member={m} itsMe={m.user_id === me?.id} projectId={projectId} act={act} />
          ))}
        </div>
      </section>

      {members.data.invites.length > 0 && (
        <section>
          <h3 className="sec-title">Ожидают ответа</h3>
          <div className="proj-rows" aria-label="Приглашения, на которые ещё не ответили">
            {members.data.invites.map((i) => (
              <InviteRow key={i.id} invite={i} projectId={projectId} act={act} />
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
            <label className="f-label" htmlFor="inv-email">
              E-mail
            </label>
            <div className="f-val">
              <Input
                id="inv-email"
                type="email"
                autoComplete="off"
                placeholder="адрес существующего аккаунта"
                style={{ flex: '1 1 240px' }}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setSent(null)
                }}
              />
            </div>
          </div>
          <div className="f-row">
            <span className="f-label" id="inv-role-label">
              Роль
            </span>
            <div className="f-val">
              <Segmented label="Роль приглашённого" options={ROLE_OPTIONS} value={role} onChange={setRole} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
            {sent && (
              <span role="status" className="set-desc" style={{ margin: 0 }}>
                Приглашение отправлено: {sent}
              </span>
            )}
            <Button variant="primary" type="submit" disabled={inviting || email.trim() === ''}>
              Пригласить
            </Button>
          </div>
        </form>
      </section>
      {problem && <Problem>{problem}</Problem>}
    </>
  )
}

type Act = (work: () => Promise<void>) => Promise<void>

function MemberRow({ member, itsMe, projectId, act }: { member: Member; itsMe: boolean; projectId: string; act: Act }) {
  const role = roleOf(member.role)
  return (
    <div className="proj-row">
      <div className="proj-person">
        <Avatar name={member.name} tone={member.tone} decorative />
        <span>
          <strong>
            {member.name}
            {itsMe ? ' (вы)' : ''}
          </strong>
          <small>{member.email}</small>
        </span>
      </div>
      <div className="proj-actions">
        {/* свою роль здесь не меняем: понизив себя, человек закрыл бы это окно, а уйти можно из меню проекта */}
        {itsMe ? (
          <span className="set-desc" style={{ margin: 0 }}>
            {ROLE_LABELS[role]}
          </span>
        ) : (
          <Segmented
            label={`Роль: ${member.name}`}
            options={ROLE_OPTIONS}
            value={role}
            onChange={(next) => void act(() => setMemberRole(projectId, member.user_id, next))}
          />
        )}
        {!itsMe && (
          <TwoStep
            id={`member:${member.user_id}`}
            label="Убрать"
            confirmLabel="Точно убрать?"
            onConfirm={() => void act(() => removeMember(projectId, member.user_id))}
          />
        )}
      </div>
    </div>
  )
}

function InviteRow({ invite, projectId, act }: { invite: PendingInvite; projectId: string; act: Act }) {
  return (
    <div className="proj-row">
      <div className="proj-person">
        <Avatar name={invite.name} tone={invite.tone} decorative />
        <span>
          <strong>{invite.name}</strong>
          <small>
            {invite.email} · {ROLE_LABELS[roleOf(invite.role)]} · ожидает ответа
          </small>
        </span>
      </div>
      <div className="proj-actions">
        <Button variant="ghost" onClick={() => void act(() => revokeInvite(projectId, invite.id))}>
          Отозвать
        </Button>
      </div>
    </div>
  )
}
