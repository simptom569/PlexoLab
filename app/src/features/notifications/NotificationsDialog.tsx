import { Avatar, Button } from '../../components'
import { useNotifications, useProjects, useUsers } from '../../lib/api/queries'
import type { Notification } from '../../lib/api/types'
import { whenText } from '../../lib/date'
import { failed } from '../../lib/query'
import { useUi } from '../../lib/ui-store'
import { DialogFrame, Problem } from '../projects/parts'
import { kindText, unreadText } from './logic'
import { useReadAllNotifications, useReadNotification } from './mutations'
import { openNotificationTask } from './open'

/**
 * «Уведомления»: меня назначили исполнителем или упомянули в комментарии. Нажатие на строку открывает задачу в её
 * проекте и отмечает уведомление прочитанным. В макете такого окна нет, оно собрано из деталей окон проектов.
 */
export function NotificationsDialog() {
  const close = useUi((s) => s.closeProjectDialog)
  const list = useNotifications()
  const read = useReadNotification()
  const readAll = useReadAllNotifications()
  const users = useUsers().data
  const projects = useProjects().data

  const usersById = new Map((users ?? []).map((u) => [u.id, u]))
  const projectName = (id: string) => projects?.find((p) => p.id === id)?.name

  const open = (n: Notification) => {
    if (!n.read) read.mutate({ id: n.id })
    openNotificationTask(n, projects)
  }

  const items = list.data?.items ?? []
  const unread = list.data?.unread ?? 0
  return (
    <DialogFrame title="Уведомления" narrow onClose={close}>
      {list.isPending ? (
        <div className="empty">Загружаю…</div>
      ) : failed(list) ? (
        <Problem>Не удалось загрузить уведомления</Problem>
      ) : items.length === 0 ? (
        <div className="empty">Уведомлений нет</div>
      ) : (
        <>
          <div className="notif-head">
            <span aria-live="polite">{unreadText(unread)}</span>
            <Button write disabled={unread === 0} onClick={() => readAll.mutate()}>
              Прочитать все
            </Button>
          </div>
          <div className="notif-list" role="list" aria-label="Уведомления">
            {items.map((n) => {
              const actor = n.actor_id ? usersById.get(n.actor_id) : undefined
              return (
                <button key={n.id} className={n.read ? 'notif' : 'notif unread'} type="button" role="listitem" onClick={() => open(n)}>
                  <Avatar name={actor?.name ?? null} tone={actor?.tone} size="sm" emptyLabel="Неизвестный автор" decorative />
                  <span className="notif-text">
                    <span className="notif-title">
                      {kindText(n.kind)}
                      {!n.read && <span className="notif-dot" role="img" aria-label="Не прочитано" />}
                    </span>
                    <span className="notif-task">
                      <span className="mono">{n.task_key}</span> {n.task_title}
                    </span>
                    {n.comment && <span className="notif-quote">{n.comment}</span>}
                    <span className="notif-meta">
                      {[actor?.name ?? 'Кто-то', projectName(n.project_id), whenText(n.created_at)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </DialogFrame>
  )
}
