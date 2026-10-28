import { useEffect, useRef } from 'react'
import { Backdrop, Icon, MenuItem, Popover } from '../../components'
import { useSession } from '../../lib/session'
import { useToast } from '../../lib/toast'
import { canLeaveTeam, canManageTeam, useCurrentTeamInfo } from '../../lib/team'
import { useUi } from '../../lib/ui-store'
import { errorText, leaveTeam } from './api'

const WIDTH = 220
const HEIGHT = 140

/**
 * Меню команды по правой кнопке на блоке PlexoLab (docs/TEAMS.md, 11.1): «Настройки команды» (администратор), «Участники»
 * (список, а у администратора вкладка настроек) и «Выйти из команды» (вторым нажатием; владельцу своего «Личного» пункта
 * нет). Гостю меню не открывается: у него в этой команде нечего показывать. Открывается у курсора.
 */
export function TeamMenu() {
  const menu = useUi((s) => s.teamMenu)
  const close = useUi((s) => s.closeTeamMenu)
  const confirm = useUi((s) => s.confirm)
  const setConfirm = useUi((s) => s.setConfirm)
  const openDialog = useUi((s) => s.openProjectDialog)
  const serverAdmin = useSession((s) => s.user?.is_admin ?? false)
  const team = useCurrentTeamInfo()
  const popover = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    // боковое меню лежит выше подложки: нажатие в нём подложка не видит, закрываем по нажатию вне меню сами (как у меню проекта)
    const onDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Element) || popover.current?.contains(target) || target.closest('.backdrop')) return
      close()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [menu, close])

  // команда ушла (вышли с другого устройства, заархивировали): меню закрываем
  const missing = menu !== null && team === null
  useEffect(() => {
    if (missing) close()
  }, [missing, close])

  if (!menu || !team) return null

  const manage = canManageTeam(team, serverAdmin)
  const leaveKey = `leave-team:${team.id}`
  const leave = async () => {
    setConfirm(null)
    close()
    try {
      await leaveTeam(team.id)
    } catch (e) {
      useToast.getState().show(errorText(e))
    }
  }

  const left = Math.max(8, Math.min(menu.x, window.innerWidth - WIDTH - 8))
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - HEIGHT - 8))

  return (
    <>
      <Backdrop onClick={close} />
      <Popover ref={popover} small role="menu" aria-label={`Команда «${team.name}»`} style={{ position: 'fixed', left, top, width: WIDTH, minWidth: 0 }}>
        {manage && (
          <MenuItem onClick={() => openDialog({ kind: 'team-settings', id: team.id, tab: 'main' })}>
            <Icon name="gear" sm />
            Настройки команды
          </MenuItem>
        )}
        <MenuItem
          onClick={() => openDialog(manage ? { kind: 'team-settings', id: team.id, tab: 'members' } : { kind: 'team-members', id: team.id })}
        >
          <Icon name="user" sm />
          Участники
        </MenuItem>
        {canLeaveTeam(team) && (
          <MenuItem
            write
            danger={confirm === leaveKey}
            onClick={() => {
              if (confirm === leaveKey) void leave()
              else setConfirm(leaveKey)
            }}
          >
            <Icon name="logout" sm />
            {confirm === leaveKey ? 'Точно выйти?' : 'Выйти из команды'}
          </MenuItem>
        )}
      </Popover>
    </>
  )
}
