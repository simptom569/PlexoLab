export const SETTINGS_TABS = ['account', 'appearance', 'board', 'server', 'data', 'app', 'hotkeys', 'about'] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

// Категории окна настроек (в макете окна нет, добавлено по просьбе владельца)
export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  account: 'Аккаунт',
  appearance: 'Внешний вид',
  board: 'Доска',
  server: 'Связь с сервером',
  data: 'Данные',
  app: 'Приложение',
  hotkeys: 'Горячие клавиши',
  about: 'О программе',
}
