// Окно приложения, трей, запуск вместе с Windows и окошки уведомлений. Всё это есть только в окне Tauri: в обычном
// браузере (разработка, тесты) функции ничего не делают. Команды окна и трея описаны в src-tauri/src/window.rs.

import { isTauri } from './runtime'

async function command(name: string): Promise<void> {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke(name)
}

/** Показать окно и вывести вперёд (из трея, из свёрнутого, из-под других окон) */
export const showWindow = (): Promise<void> => command('show_main_window')

/** Спрятать окно в трей: приложение продолжает работать */
export const hideWindow = (): Promise<void> => command('hide_main_window')

/** Завершить приложение целиком */
export const quitApp = (): Promise<void> => command('quit_app')

/** Выбрали «Выйти» в меню трея. Возвращает функцию, которая отписывает. */
export async function onTrayQuit(handler: () => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event')
  return listen('tray-quit', handler)
}

/** Запуск вместе с Windows включён? В браузере его нет: `false`. */
export async function isAutostartEnabled(): Promise<boolean> {
  if (!isTauri()) return false
  const { isEnabled } = await import('@tauri-apps/plugin-autostart')
  return isEnabled()
}

export async function setAutostart(on: boolean): Promise<void> {
  if (!isTauri()) return
  const { enable, disable } = await import('@tauri-apps/plugin-autostart')
  await (on ? enable() : disable())
}

/** Окошко Windows */
export type Toast = { title: string; body: string; extra: Record<string, unknown> }

let permission: Promise<boolean> | null = null

/** Windows разрешает окошки сразу; на других системах один раз спросим */
function toastAllowed(): Promise<boolean> {
  permission ??= import('@tauri-apps/plugin-notification').then(async (n) => (await n.isPermissionGranted()) || (await n.requestPermission()) === 'granted')
  return permission
}

/** Показывает окошко. В браузере и без разрешения ничего не делает. */
export async function showToast(toast: Toast): Promise<void> {
  if (!isTauri() || !(await toastAllowed())) return
  const { sendNotification } = await import('@tauri-apps/plugin-notification')
  sendNotification(toast)
}

/**
 * На окошко нажали. `extra` — то, что положили в него при показе. Windows сообщает о нажатии, пока окошко на экране;
 * когда оно уехало в центр уведомлений, нажатие приложение не узнает. Слушатель надо поставить до показа окошка.
 */
export async function onToastClick(handler: (extra: Record<string, unknown>) => void): Promise<() => void> {
  if (!isTauri()) return () => undefined
  const { onAction } = await import('@tauri-apps/plugin-notification')
  const listener = await onAction((event) => handler(event.notification?.extra ?? {}))
  return () => void listener.unregister()
}
