import { useEffect, useRef } from 'react'
import { api } from '../../lib/api/client'
import { keys } from '../../lib/api/queries'
import type { NotificationList, Project } from '../../lib/api/types'
import { onToastClick, showToast, showWindow } from '../../lib/platform/desktop'
import { isTauri } from '../../lib/platform/runtime'
import { queryClient } from '../../lib/query'
import { useUi } from '../../lib/ui-store'
import { openNotificationTask } from './open'
import { GROUP_MS, ToastPlanner, toastTarget } from './toasts'

/** Нажали на окошко: показываем окно и открываем то, о чём оно (задача или список) */
function openFromToast(extra: Record<string, unknown>): void {
  void showWindow()
  const target = toastTarget(extra)
  if (target.kind === 'list') {
    useUi.getState().openProjectDialog({ kind: 'notifications' })
    return
  }
  openNotificationTask({ project_id: target.projectId, task_id: target.taskId }, queryClient.getQueryData<Project[]>(keys.projects))
  // как при нажатии в списке: открыл, значит прочитал
  void api
    .post(`/notifications/${target.notificationId}/read`)
    .then(() => queryClient.invalidateQueries({ queryKey: keys.notifications }))
    .catch(() => undefined)
}

/**
 * Окошки Windows о новых уведомлениях, пока приложение не перед глазами (свёрнуто, в трее, под другими окнами).
 * Список приходит живыми обновлениями, поэтому окошко появляется сразу; что пришло пачкой, уходит одним окошком
 * (features/notifications/toasts.ts). Только в окне Tauri.
 */
export function useDesktopNotifications(list: NotificationList | undefined): void {
  const planner = useRef(new ToastPlanner())
  // слушатель нажатий должен стоять до первого окошка: без него Windows показывает окошко без нажатия
  const listening = useRef<Promise<() => void> | null>(null)

  useEffect(() => {
    if (!isTauri()) return
    const stop = onToastClick(openFromToast)
    listening.current = stop
    return () => void stop.then((unlisten) => unlisten())
  }, [])

  useEffect(() => {
    if (!isTauri() || !list) return
    const timer = setTimeout(() => {
      // выключатель читаем в момент показа: переключили, пока ждали секунду, значит, действует новое значение
      const toast = planner.current.plan(list, document.hasFocus(), useUi.getState().toasts)
      if (toast) void (listening.current ?? Promise.resolve()).then(() => showToast(toast))
    }, GROUP_MS)
    return () => clearTimeout(timer)
  }, [list])
}
