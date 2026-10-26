// Название страницы-копии, в которую сохраняются правки, не вошедшие в страницу при конфликте:
// «План релиза (правки Лены М., 25.10 14:05)». Сервер принимает названия до 200 знаков.

/** Самое длинное название страницы или документа на сервере */
export const MAX_TITLE_LEN = 200

const two = (n: number) => String(n).padStart(2, '0')

/** Дата и время по часам человека: «25.10 14:05» */
export function stamp(at: Date): string {
  return `${two(at.getDate())}.${two(at.getMonth() + 1)} ${two(at.getHours())}:${two(at.getMinutes())}`
}

/**
 * Название копии: прежнее название, затем «(правки Имя, дд.мм чч:мм)». У страницы без названия вместо него «Без названия».
 * Слишком длинное прежнее название обрезается с многоточием, чтобы целиком уложиться в лимит сервера.
 */
export function copyTitle(title: string, who: string, at: Date): string {
  const suffix = `(правки ${who.trim() || 'без имени'}, ${stamp(at)})`
  const base = title.trim() || 'Без названия'
  const room = MAX_TITLE_LEN - suffix.length - 1
  const head = base.length > room ? `${base.slice(0, Math.max(1, room - 1)).trimEnd()}…` : base
  return `${head} ${suffix}`
}
