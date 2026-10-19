// Прогресс модулей и вех и подписи к нему. Перенесено из vModules и vReleases макета; ничего не знает про React и сеть.

import { DAY, plural, toMs } from './date'

/** Процент выполненного, целое число; без задач — 0 */
export const percent = (done: number, total: number): number => (total ? Math.round((done / total) * 100) : 0)

/** «2 из 5 задач», «0 из 1 задачи» (после «из» слово стоит в родительном падеже) */
export const tasksText = (done: number, total: number): string => `${done} из ${total} ${plural(total, 'задачи', 'задач', 'задач')}`

/** Подпись срока вехи («через 5 дн.», «просрочена на 3 дн.», «прошла») и признак просрочки */
export function milestoneWhen(due: string, today: string, pct: number): { text: string; late: boolean } {
  const days = Math.round((toMs(due) - toMs(today)) / DAY)
  const text = days === 0 ? 'сегодня' : days > 0 ? `через ${days} дн.` : pct === 100 ? 'прошла' : `просрочена на ${-days} дн.`
  return { text, late: days < 0 && pct < 100 }
}
