/** Не короче, чем принимает сервер (domain::auth::MIN_PASSWORD_LEN) */
export const MIN_PASSWORD_LEN = 8

/**
 * Подсказка до отправки: те же правила, что у сервера, чтобы не ждать ответа из-за опечатки. Решает всё равно сервер.
 * Возвращает текст ошибки или null, если форму можно отправлять.
 */
export function checkPasswordForm(current: string, next: string, again: string): string | null {
  if (!current) return 'Введите текущий пароль'
  if ([...next].length < MIN_PASSWORD_LEN) return `Новый пароль короче ${MIN_PASSWORD_LEN} символов`
  if (next !== again) return 'Пароли не совпадают'
  if (next === current) return 'Новый пароль совпадает с текущим'
  return null
}
