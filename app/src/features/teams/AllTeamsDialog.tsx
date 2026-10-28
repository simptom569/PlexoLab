import { useDeferredValue, useEffect, useState } from 'react'
import { Button, Input } from '../../components'
import { useAdminTeams } from '../../lib/api/queries'
import { plural } from '../../lib/date'
import { failed } from '../../lib/query'
import { useSession } from '../../lib/session'
import { useUi } from '../../lib/ui-store'
import { DialogFrame, Problem } from '../projects/parts'

/**
 * «Все команды сервера» (docs/TEAMS.md, раздел 9): только администратору сервера. В переключателе у него только его команды,
 * остальные находятся здесь по названию (а «Личное» ещё по имени и e-mail владельца) и открываются в том же окне приложения.
 */
export function AllTeamsDialog() {
  const close = useUi((s) => s.closeProjectDialog)
  const setTeam = useUi((s) => s.setTeam)
  const serverAdmin = useSession((s) => s.user?.is_admin ?? false)
  const [q, setQ] = useState('')
  const deferred = useDeferredValue(q.trim())
  const teams = useAdminTeams(deferred, serverAdmin)

  // не администратор сервера окна не видит
  useEffect(() => {
    if (!serverAdmin) close()
  }, [serverAdmin, close])

  const list = teams.data ?? []
  return (
    <DialogFrame title="Все команды сервера" narrow onClose={close}>
      <Input
        autoFocus
        type="search"
        aria-label="Найти команду"
        placeholder="Название команды, имя или e-mail владельца «Личного»"
        style={{ width: '100%' }}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div style={{ marginTop: 12 }}>
        {teams.isPending ? (
          <div className="empty">Загружаю…</div>
        ) : failed(teams) ? (
          <Problem>Не удалось загрузить команды</Problem>
        ) : list.length === 0 ? (
          <div className="empty">Ничего не найдено</div>
        ) : (
          <div className="proj-rows" aria-label="Команды сервера">
            {list.map((t) => (
              <div className="proj-row" key={t.id}>
                <div className="set-text">
                  <div className="set-label">
                    {t.name}
                    {t.personal && t.owner_name ? ` · ${t.owner_name}` : ''}
                    {t.archived && <span className="tag-guest" style={{ marginLeft: 8 }}>в архиве</span>}
                  </div>
                  <div className="set-desc">
                    {t.member_count} {plural(t.member_count, 'участник', 'участника', 'участников')} · {t.project_count}{' '}
                    {plural(t.project_count, 'проект', 'проекта', 'проектов')}
                  </div>
                </div>
                <Button
                  onClick={() => {
                    close()
                    setTeam(t.id)
                  }}
                >
                  Открыть
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </DialogFrame>
  )
}
