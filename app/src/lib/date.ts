// Работа с датами `ГГГГ-ММ-ДД`: перенесено из макета без изменения поведения (toMs, iso, addD, fd, plural).
// Всё считается по UTC, чтобы переход на летнее время не сдвигал дни.

export const DAY = 86_400_000
export const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
export const MONF = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
/** Месяцы в родительном падеже: «15 октября» */
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

export const toMs = (s: string): number => {
  const [y, m, d] = s.split('-').map(Number)
  return Date.UTC(y!, m! - 1, d!)
}

export const iso = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export const addDays = (s: string, n: number): string => iso(toMs(s) + n * DAY)

/** Короткая дата: «19 окт» */
export const fd = (s: string | null | undefined): string => (s ? `${+s.slice(8, 10)} ${MON[+s.slice(5, 7) - 1]}` : '')

/** Сегодняшний день по часам этого компьютера (в интерфейсе «сегодня» всегда настоящее) */
export const todayIso = (now: Date = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

/** Понедельник недели, в которую попадает день */
export const mondayOf = (s: string): string => {
  const weekday = (new Date(toMs(s)).getUTCDay() + 6) % 7 // 0 — понедельник
  return addDays(s, -weekday)
}

/** Склонение числительных: 1 задача, 2 задачи, 5 задач */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}

const hhmm = (d: Date): string => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/** Время события для людей: «только что», «12 минут назад», «вчера, 17:40», «12 окт, 09:05» (по часам этого компьютера) */
export function whenText(timestamp: string, now: Date = new Date()): string {
  const at = new Date(timestamp)
  const mins = Math.floor((now.getTime() - at.getTime()) / 60_000)
  if (mins < 1) return 'только что'
  const day = todayIso(at)
  const today = todayIso(now)
  if (day === today) {
    if (mins < 60) return `${mins} ${plural(mins, 'минуту', 'минуты', 'минут')} назад`
    const hours = Math.floor(mins / 60)
    return `${hours} ${plural(hours, 'час', 'часа', 'часов')} назад`
  }
  if (day === addDays(today, -1)) return `вчера, ${hhmm(at)}`
  return `${fd(day)}, ${hhmm(at)}`
}

/** День события по часам этого компьютера, `ГГГГ-ММ-ДД`: по нему лента собирается в группы */
export const dayOf = (timestamp: string): string => todayIso(new Date(timestamp))

/** Заголовок группы дня в ленте: «Сегодня», «Вчера», «15 октября» (с годом, если он не нынешний) */
export function dayHeading(day: string, now: Date = new Date()): string {
  const today = todayIso(now)
  if (day === today) return 'Сегодня'
  if (day === addDays(today, -1)) return 'Вчера'
  const text = `${+day.slice(8, 10)} ${MONTHS_GEN[+day.slice(5, 7) - 1]}`
  return day.slice(0, 4) === today.slice(0, 4) ? text : `${text} ${day.slice(0, 4)}`
}
