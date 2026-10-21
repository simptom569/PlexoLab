// Id задач и ключи (docs/PROJECTS.md, раздел 4): разбор подписи, сортировка и число задач, у которых от смены
// ключа изменится id. Ничего не знает про React и сеть.

import type { Board } from './api/types'
import { plural } from './date'

/** Подпись и номер из id задачи: «SEO-3» → «SEO» и 3 */
export function splitTaskKey(key: string): { prefix: string; number: number } {
  const dash = key.lastIndexOf('-')
  return { prefix: dash < 0 ? key : key.slice(0, dash), number: dash < 0 ? 0 : Number(key.slice(dash + 1)) }
}

/**
 * Порядок id в таблице: по ключу, потом по номеру. Ключи из латиницы и цифр в верхнем регистре, поэтому достаточно
 * сравнить строки; число сравнивается как число (`WEB-9` раньше `WEB-10`).
 */
export function compareTaskKeys(a: string, b: string): number {
  const x = splitTaskKey(a)
  const y = splitTaskKey(b)
  if (x.prefix !== y.prefix) return x.prefix < y.prefix ? -1 : 1
  return x.number - y.number
}

/** «У 3 задач изменятся id», «У 1 задачи изменятся id» */
export const idsChangeText = (count: number): string => `У ${count} ${plural(count, 'задачи', 'задач', 'задач')} изменятся id`

/** Что нумеруется рядом проекта: ключ проекта, а без него `TASK` */
export const projectPrefix = (projectKey: string | null | undefined): string => projectKey ?? 'TASK'

/**
 * Сколько задач сменят id, если поменять ключ модуля (поставить, убрать или переименовать): все задачи модуля.
 * Первый ключ и снятие переносят их в другой ряд (новые номера), переименование меняет только подпись.
 */
export const moduleKeyChangeCount = (board: Board, moduleId: string): number => board.tasks.filter((t) => t.module_id === moduleId).length

/** Сколько задач сменят подпись, если поменять ключ проекта: те, что нумеруются рядом проекта (без модуля или в модуле без ключа) */
export function projectKeyChangeCount(board: Board): number {
  const keyed = new Set(board.modules.filter((m) => m.key).map((m) => m.id))
  return board.tasks.filter((t) => !t.module_id || !keyed.has(t.module_id)).length
}

/** Пояснение к окну «У N задач изменятся id» для смены ключа модуля */
export function moduleKeyChangeDetail(from: string | null | undefined, to: string | null, projectKey: string | null | undefined): string {
  if (from && to) return `Номера останутся прежними, изменится только префикс: ${from}-… станет ${to}-…`
  if (to) return `Задачи модуля перейдут в его собственную нумерацию: ${to}-1, ${to}-2 и так далее. Прежние id перестанут их находить.`
  return `Задачи модуля вернутся в нумерацию проекта (${projectPrefix(projectKey)}-…) и получат новые номера. Прежние id перестанут их находить.`
}

/** Пояснение к тому же окну для смены ключа проекта: номера те же, меняется префикс */
export const projectKeyChangeDetail = (from: string | null | undefined, to: string | null): string =>
  `Номера останутся прежними, изменится только префикс: ${projectPrefix(from)}-… станет ${projectPrefix(to)}-…`
