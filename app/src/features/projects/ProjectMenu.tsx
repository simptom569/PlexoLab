import { useEffect, useRef } from 'react'
import { Backdrop, Icon, MenuItem, Popover } from '../../components'
import { useProjects } from '../../lib/api/queries'
import { useSession } from '../../lib/session'
import { useToast } from '../../lib/toast'
import { useUi } from '../../lib/ui-store'
import { errorText, removeMember } from './api'

const WIDTH = 220
const HEIGHT = 96

/**
 * Меню проекта по правой кнопке на его строке в боковом меню: «Настройки проекта» (только администратору) и
 * «Выйти из проекта» (всем, вторым нажатием). Открывается у курсора.
 */
export function ProjectMenu() {
  const menu = useUi((s) => s.projectMenu)
  const close = useUi((s) => s.closeProjectMenu)
  const confirm = useUi((s) => s.confirm)
  const setConfirm = useUi((s) => s.setConfirm)
  const openDialog = useUi((s) => s.openProjectDialog)
  const me = useSession((s) => s.user)
  const projects = useProjects()
  const project = projects.data?.find((p) => p.id === menu?.id)
  const popover = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    // Боковое меню лежит выше подложки (z-index 40 против 30, см. shell.css), поэтому нажатие в нём подложка не видит.
    // Закрываем по нажатию вне меню сами; само нажатие идёт дальше, так что другой проект или раздел открывается с первого раза.
    // Нажатие на подложке не трогаем: она закрывает меню своим кликом и не даёт ему попасть в страницу под ней.
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

  // проекта уже нет в списке (вышли с другого устройства): меню закрываем
  const missing = menu !== null && projects.isSuccess && !project
  useEffect(() => {
    if (missing) close()
  }, [missing, close])

  if (!menu || !project || !me) return null

  const leaveKey = `leave:${project.id}`
  const leave = async () => {
    setConfirm(null)
    close()
    try {
      await removeMember(project.id, me.id)
    } catch (e) {
      // единственный администратор уйти не может: сервер объясняет, что делать
      useToast.getState().show(errorText(e))
    }
  }

  // чтобы меню не вылезало за экран у правого и нижнего края
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - WIDTH - 8))
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - HEIGHT - 8))

  return (
    <>
      <Backdrop onClick={close} />
      <Popover ref={popover} small role="menu" aria-label={`Проект «${project.name}»`} style={{ position: 'fixed', left, top, width: WIDTH, minWidth: 0 }}>
        {project.role === 'admin' && (
          <MenuItem onClick={() => openDialog({ kind: 'settings', id: project.id, tab: 'main' })}>
            <Icon name="gear" sm />
            Настройки проекта
          </MenuItem>
        )}
        <MenuItem
          danger={confirm === leaveKey}
          onClick={() => {
            if (confirm === leaveKey) void leave()
            else setConfirm(leaveKey)
          }}
        >
          <Icon name="logout" sm />
          {confirm === leaveKey ? 'Точно выйти?' : 'Выйти из проекта'}
        </MenuItem>
      </Popover>
    </>
  )
}
