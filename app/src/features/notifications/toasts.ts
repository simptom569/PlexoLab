// Окошки Windows о новых уведомлениях (docs/OFFLINE-NOTIFY-SEARCH.md, раздел 2): что показывать и когда.
// Здесь только решения, без Tauri: показывает и слушает нажатия lib/platform/desktop.ts, подключает useDesktopNotifications.

import type { Notification, NotificationList } from '../../lib/api/types'
import type { Toast } from '../../lib/platform/desktop'
import { kindText } from './logic'

/** Сколько ждать после очередного изменения списка, прежде чем показывать: что пришло пачкой, уйдёт одним окошком */
export const GROUP_MS = 1_000

/** Комментарий в окошке: сервер уже отдаёт короткий отрывок, это страховка от длинного */
const COMMENT_MAX = 120

const shorten = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > COMMENT_MAX ? `${flat.slice(0, COMMENT_MAX - 1)}…` : flat
}

/** Окошко об одном уведомлении: что случилось, задача и отрывок комментария */
function single(n: Notification): Toast {
  const quote = n.comment ? `\n${shorten(n.comment)}` : ''
  return {
    title: kindText(n.kind),
    body: `${n.task_key} ${n.task_title}${quote}`,
    // нажатие на окошко откроет эту задачу
    extra: { notificationId: n.id, projectId: n.project_id, taskId: n.task_id },
  }
}

/** Несколько сразу (запуск приложения, возврат связи): одно окошко вместо пачки. Нажатие откроет список. */
const many = (count: number): Toast => ({ title: 'PlexoLab', body: `Новых уведомлений: ${count}`, extra: {} })

/** Окошко для только что пришедших непрочитанных; ни одного: окошка нет */
export function toastFor(fresh: Notification[]): Toast | null {
  if (fresh.length === 0) return null
  return fresh.length === 1 ? single(fresh[0]!) : many(fresh.length)
}

/**
 * Помнит, о каких непрочитанных уже сказано (окошком или тем, что окно было перед глазами), и по каждому новому списку
 * решает, что показать. После запуска всё непрочитанное считается новым, но показывается одним окошком.
 */
export class ToastPlanner {
  private announced = new Set<string>()

  /** `focused`: приложение перед глазами. Тогда непрочитанное видно и так (точка в боковом меню), окошко не нужно. */
  plan(list: NotificationList, focused: boolean): Toast | null {
    const fresh = list.items.filter((n) => !n.read && !this.announced.has(n.id))
    // помним только то, что ещё в списке: старое выпадает вместе с ним
    const inList = new Set(list.items.map((n) => n.id))
    this.announced = new Set([...this.announced].filter((id) => inList.has(id)))
    for (const n of fresh) this.announced.add(n.id)
    return focused ? null : toastFor(fresh)
  }
}

/** Что лежит в окошке, чтобы открыть нужное по нажатию: задача или (для пачки) список уведомлений */
export type ToastTarget = { kind: 'task'; notificationId: string; projectId: string; taskId: string } | { kind: 'list' }

export function toastTarget(extra: Record<string, unknown>): ToastTarget {
  const { notificationId, projectId, taskId } = extra
  if (typeof notificationId === 'string' && typeof projectId === 'string' && typeof taskId === 'string') {
    return { kind: 'task', notificationId, projectId, taskId }
  }
  return { kind: 'list' }
}
