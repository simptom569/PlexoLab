// Защита при закрытии приложения: пока в окне есть неотправленный текст (lib/unsent.ts), закрыть его молча нельзя.
// Сначала пробуем отправить всё за пару секунд, и если не вышло (нет связи), спрашиваем человека.

import { flushUnsent, unsentCount } from './unsent'

/** Сколько дать неотправленному тексту на отправку, прежде чем спрашивать */
export const CLOSE_WAIT_MS = 2_000

export type CloseDeps = {
  unsentCount: () => number
  flushUnsent: () => Promise<void>
  /** Спросить человека: `true` — закрыть всё равно */
  ask: () => Promise<boolean>
  /** Пауза (тестам нужна своя) */
  wait?: (ms: number) => Promise<void>
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Окно просят закрыть. `close` — закрывать, `stay` — остаться. Нет несохранённого: закрываем без вопросов. Есть:
 * отправляем, и если за `CLOSE_WAIT_MS` всё ушло, закрываем, а если нет, решает человек.
 */
export async function handleCloseRequest(deps: CloseDeps = realDeps()): Promise<'close' | 'stay'> {
  if (deps.unsentCount() === 0) return 'close'
  await Promise.race([deps.flushUnsent().catch(() => undefined), (deps.wait ?? sleep)(CLOSE_WAIT_MS)])
  if (deps.unsentCount() === 0) return 'close'
  return (await deps.ask()) ? 'close' : 'stay'
}

/**
 * Нажали крестик на окне. `hide` — спрятать в трей: настройка «Сворачивать в трей при закрытии» включена, приложение
 * живёт дальше, и неотправленный текст уйдёт сам (спрашивать нечего). Выключена: как `handleCloseRequest`.
 */
export async function handleWindowClose(closeToTray: boolean, deps?: CloseDeps): Promise<'hide' | 'close' | 'stay'> {
  if (closeToTray) return 'hide'
  return handleCloseRequest(deps)
}

/**
 * Выбрали «Выйти» в меню трея. Окно может быть спрятано, а вопрос про неотправленный текст задаётся в окне:
 * если текст есть, сначала показываем окно (`reveal`).
 */
export async function handleTrayQuit(reveal: () => Promise<void>, deps: CloseDeps = realDeps()): Promise<'close' | 'stay'> {
  if (deps.unsentCount() > 0) await reveal()
  return handleCloseRequest(deps)
}

const realDeps = (): CloseDeps => ({ unsentCount, flushUnsent, ask: askPerson })

async function askPerson(): Promise<boolean> {
  const { useCloseAsk } = await import('./closeAsk')
  return useCloseAsk.getState().ask()
}

/**
 * Браузер (разработка, тесты): перед закрытием вкладки или окна просит подтверждение, если есть несохранённое.
 * Текст вопроса задаёт сам браузер.
 */
export function guardUnload(event: { preventDefault: () => void; returnValue: unknown }, unsent: number = unsentCount()): void {
  if (unsent === 0) return
  event.preventDefault()
  event.returnValue = ''
  void flushUnsent() // вдруг успеет, пока человек читает вопрос
}
