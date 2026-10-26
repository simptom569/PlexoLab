// Связь с сервером и режим «только просмотр» (docs/OFFLINE-NOTIFY-SEARCH.md, раздел 1).
//
// Связи нет, как только запрос не дошёл до сервера, прокси ответил 502–504, закрылось живое соединение или система
// сообщила, что сети нет. Связь вернулась, когда сервер ответил на любой запрос или на проверку `/healthz`. Пока связи
// нет, она проверяется сама: через секунду, потом каждые четыре.
//
// Режим «только просмотр» включается, когда связи нет `READ_ONLY_AFTER_MS` подряд: короткий сбой Wi-Fi не должен
// мигать блокировкой. Выключается сразу, как связь вернулась.
//
// Модуль ничего не знает про сеть и сессию (их подставляют `setLinkProbe` и вызовы `linkLost`/`linkRestored`):
// так он не зависит от клиента API, который сам его использует.

import { create } from 'zustand'

/** Сколько связи нет, прежде чем править станет нельзя */
export const READ_ONLY_AFTER_MS = 3_000
/** Первая проверка после потери связи: короткий сбой пройдёт раньше, чем включится просмотр */
export const FIRST_PROBE_MS = 1_000
/** Дальше проверяем с такой паузой */
export const PROBE_EVERY_MS = 4_000

type LinkState = {
  /** Связи нет (с первой неудачи) */
  down: boolean
  /** Правки закрыты: связи нет уже `READ_ONLY_AFTER_MS` */
  readOnly: boolean
}

export const useLink = create<LinkState>()(() => ({ down: false, readOnly: false }))

/** Запись отклонена без сети: связи нет, сейчас можно только смотреть */
export class OfflineError extends Error {
  constructor() {
    super('Нет связи с сервером, сейчас можно только смотреть')
    this.name = 'OfflineError'
  }
}

let probe: () => Promise<boolean> = async () => false

/** Как проверить, отвечает ли сервер (подставляет вход: ему известен адрес сервера) */
export function setLinkProbe(fn: () => Promise<boolean>): void {
  probe = fn
}

const restoredListeners = new Set<() => void>()

/** Связь вернулась (после того, как её не было): перечитать данные, отправить накопленное. Возвращает отписку. */
export function onLinkRestored(listener: () => void): () => void {
  restoredListeners.add(listener)
  return () => void restoredListeners.delete(listener)
}

let readOnlyTimer: ReturnType<typeof setTimeout> | undefined
let probeTimer: ReturnType<typeof setTimeout> | undefined
let probing = false

/** Связи нет. Повторные вызовы ничего не меняют. */
export function linkLost(): void {
  if (useLink.getState().down) return
  useLink.setState({ down: true })
  clearTimeout(readOnlyTimer)
  readOnlyTimer = setTimeout(() => useLink.setState({ readOnly: true }), READ_ONLY_AFTER_MS)
  scheduleProbe(FIRST_PROBE_MS)
}

/** Сервер ответил. Если связи не было, объявляет, что она вернулась. */
export function linkRestored(): void {
  if (!useLink.getState().down) return
  clearTimeout(readOnlyTimer)
  clearTimeout(probeTimer)
  useLink.setState({ down: false, readOnly: false })
  for (const listener of [...restoredListeners]) listener()
}

/** Проверить связь сейчас, не дожидаясь паузы: сеть вернулась или окно снова на виду */
export function probeLinkNow(): void {
  if (!useLink.getState().down) return
  clearTimeout(probeTimer)
  void runProbe()
}

/** Вышли из приложения: всё забыто, таймеры остановлены */
export function resetLink(): void {
  clearTimeout(readOnlyTimer)
  clearTimeout(probeTimer)
  probing = false
  useLink.setState({ down: false, readOnly: false })
}

function scheduleProbe(ms: number): void {
  clearTimeout(probeTimer)
  probeTimer = setTimeout(() => void runProbe(), ms)
}

async function runProbe(): Promise<void> {
  if (!useLink.getState().down || probing) return
  probing = true
  let ok = false
  try {
    ok = await probe()
  } catch {
    ok = false
  } finally {
    probing = false
  }
  if (ok) linkRestored()
  else if (useLink.getState().down) scheduleProbe(PROBE_EVERY_MS)
}

/** Правки закрыты (режим «только просмотр»): для полей, кнопок и переноса */
export const useReadOnly = (): boolean => useLink((s) => s.readOnly)
