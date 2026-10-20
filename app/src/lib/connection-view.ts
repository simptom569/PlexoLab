import type { ConnectionStatus } from './realtime/connection'

// Как показывать состояние связи с сервером. В макете его нет (добавлено по плану этапа 8), цвета взяты из его переменных.
// label — коротко (меню пользователя, настройки), text — полная подпись для скринридера и всплывающей подсказки.
export const CONNECTION_VIEW: Record<ConnectionStatus, { color: string; label: string; text: string }> = {
  open: { color: 'var(--ok)', label: 'Связь есть', text: 'Связь с сервером есть: изменения других участников видны сразу' },
  connecting: { color: 'var(--warn)', label: 'Подключаюсь…', text: 'Подключаюсь к серверу…' },
  offline: { color: 'var(--bug-fg)', label: 'Нет связи', text: 'Нет связи с сервером, пробую подключиться снова' },
}
