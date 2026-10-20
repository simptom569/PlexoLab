// Фильтры ленты активности: участник и тип события. Хранятся на этом компьютере (на сервер не уходят).

import { create } from 'zustand'
import { saveSettings, type ActKind, type Settings } from '../../lib/settings'

type ActivityState = {
  /** 'all' или идентификатор участника (actWho в макете) */
  who: string
  kind: ActKind
  setWho: (who: string) => void
  setKind: (kind: ActKind) => void
}

export const useActivityStore = create<ActivityState>()((set) => ({
  who: 'all',
  kind: 'all',
  setWho: (who) => set({ who }),
  setKind: (kind) => set({ kind }),
}))

/** Подставляет сохранённое при запуске */
export function hydrateActivity(settings: Settings): void {
  useActivityStore.setState({ who: settings.actWho, kind: settings.actKind })
}

useActivityStore.subscribe((state, prev) => {
  if (state.who !== prev.who) saveSettings({ actWho: state.who })
  if (state.kind !== prev.kind) saveSettings({ actKind: state.kind })
})
