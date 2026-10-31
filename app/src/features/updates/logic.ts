// Обновления приложения: состояния и расчёты без Tauri. Проверяет и ставит lib/platform/updater.ts, состояние держит store.ts.

import type { DownloadEvent } from '../../lib/platform/updater'

/** Сколько ждать после запуска, прежде чем впервые спросить GitHub: чтобы не мешать загрузке окна */
export const FIRST_CHECK_DELAY_MS = 15_000
/** Как часто проверять, пока приложение работает: оно днями живёт в трее */
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

export type UpdatePhase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'upToDate' }
  | { kind: 'available'; version: string }
  /** `percent` пуст, пока сервер не сообщил размер файла */
  | { kind: 'downloading'; version: string; percent: number | null }
  /** Проверка не вышла: нет связи, в релизе нет файла обновления */
  | { kind: 'error'; during: 'check' }
  /** Не вышла установка: версия известна, можно повторить */
  | { kind: 'error'; during: 'install'; version: string }

export type Progress = { total: number | null; received: number }

export const START_PROGRESS: Progress = { total: null, received: 0 }

export function applyDownloadEvent(progress: Progress, event: DownloadEvent): Progress {
  switch (event.event) {
    case 'Started':
      return { total: event.data.contentLength && event.data.contentLength > 0 ? event.data.contentLength : null, received: 0 }
    case 'Progress':
      return { ...progress, received: progress.received + event.data.chunkLength }
    case 'Finished':
      return progress.total === null ? progress : { ...progress, received: progress.total }
  }
}

/** Сколько скачано в процентах, целое от 0 до 100; размер файла неизвестен — `null` */
export function percentOf(progress: Progress): number | null {
  if (progress.total === null) return null
  return Math.min(100, Math.floor((progress.received * 100) / progress.total))
}

/** Версия, о которой надо напомнить (точка у имени, пункт в меню пользователя): найдена и ещё не установлена */
export function pendingVersion(phase: UpdatePhase): string | null {
  if (phase.kind === 'available' || phase.kind === 'downloading') return phase.version
  if (phase.kind === 'error' && phase.during === 'install') return phase.version
  return null
}

export type UpdateView = {
  description: string
  /** Что пошло не так: показывается под описанием красным */
  problem: string | null
  button: { label: string; action: 'check' | 'install'; disabled: boolean; primary: boolean }
}

const WAITING = 'Приложение само проверит, вышла ли новая версия.'

/** Что показывать в строке «Обновления» окна «О программе» */
export function updateView(phase: UpdatePhase, desktop: boolean): UpdateView {
  const check = (label = 'Проверить обновления', disabled = false): UpdateView['button'] => ({ label, action: 'check', disabled, primary: false })
  const install = (label: string, disabled: boolean): UpdateView['button'] => ({ label, action: 'install', disabled, primary: true })
  if (!desktop) return { description: 'Проверка обновлений работает только в приложении для Windows.', problem: null, button: check('Проверить обновления', true) }
  switch (phase.kind) {
    case 'idle':
      return { description: WAITING, problem: null, button: check() }
    case 'checking':
      return { description: 'Проверяю…', problem: null, button: check('Проверяю…', true) }
    case 'upToDate':
      return { description: 'У вас последняя версия.', problem: null, button: check() }
    case 'available':
      return { description: `Доступна версия ${phase.version}. Приложение закроется, поставит обновление и откроется снова.`, problem: null, button: install('Установить и перезапустить', false) }
    case 'downloading':
      return { description: `Скачиваю версию ${phase.version}${phase.percent === null ? '…' : `: ${phase.percent}%`}`, problem: null, button: install('Устанавливаю…', true) }
    case 'error':
      return phase.during === 'check'
        ? { description: WAITING, problem: 'Не удалось проверить обновления. Проверьте связь и попробуйте ещё раз.', button: check() }
        : { description: `Доступна версия ${phase.version}.`, problem: 'Не удалось установить обновление. Попробуйте ещё раз.', button: install('Повторить', false) }
  }
}
