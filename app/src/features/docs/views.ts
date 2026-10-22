// Вид холста по документам: где стоит камера и в каком масштабе. Личная настройка этого компьютера (CLAUDE.md), на сервер не
// уходит и у других участников не меняется. Лежит в lib/settings.ts вместе с остальным: открытая страница, фильтры, тема.

import { getSettings, saveSettings } from '../../lib/settings'
import { clampZoom, type Camera } from './camera'

/** Сколько документов помним: самые давние вытесняются */
export const MAX_REMEMBERED_VIEWS = 100

/** Запомненный вид документа или null, если его не открывали или он был в начальном положении */
export function rememberedView(docId: string): Camera | null {
  const view = getSettings().canvasViews[docId]
  return view ? { x: view.x, y: view.y, z: clampZoom(view.z) } : null
}

/** Начальное положение (сдвига нет, 100%) не храним: оно и так по умолчанию */
const isHome = (c: Camera): boolean => Math.round(c.x) === 0 && Math.round(c.y) === 0 && Math.abs(c.z - 1) < 0.005

/** Запоминает вид документа; недавно открытые идут в конец, лишние давние убираются */
export function rememberView(docId: string, cam: Camera): void {
  const views = { ...getSettings().canvasViews }
  const before = views[docId] ?? null
  const next = isHome(cam) ? null : { x: Math.round(cam.x), y: Math.round(cam.y), z: Math.round(cam.z * 1000) / 1000 }
  if (before?.x === next?.x && before?.y === next?.y && before?.z === next?.z) return // ничего не изменилось: диск не трогаем
  delete views[docId]
  if (next) views[docId] = next
  const ids = Object.keys(views)
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_REMEMBERED_VIEWS))) delete views[id]
  saveSettings({ canvasViews: views })
}
