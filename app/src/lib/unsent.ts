// Учёт черновиков, у которых есть несохранённое: страницы вики, документы, холсты. Нужен двум вещам: когда связь
// вернулась, всё накопленное уходит сразу, не дожидаясь очередного повтора; полоска «Нет связи» и (этап Н2) защита при
// закрытии приложения знают, есть ли что терять.

import { onLinkRestored } from './link'

/** То, что может держать несохранённое: черновик страницы, документа, холста */
export interface Unsent {
  readonly dirty: boolean
  flush(): Promise<void>
}

const drafts = new Set<Unsent>()

/** Черновик начал жить: следить за ним */
export function trackUnsent(draft: Unsent): void {
  drafts.add(draft)
}

/** Черновик больше не нужен (страницу удалили, вышли из приложения) */
export function untrackUnsent(draft: Unsent): void {
  drafts.delete(draft)
}

/** Сколько черновиков сейчас держат несохранённое */
export function unsentCount(): number {
  let n = 0
  for (const d of drafts) if (d.dirty) n++
  return n
}

/** Отправить всё несохранённое; готово, когда ответили на все запросы (удачно или нет) */
export async function flushUnsent(): Promise<void> {
  await Promise.allSettled([...drafts].filter((d) => d.dirty).map((d) => d.flush()))
}

// связь вернулась: накопленное уходит сразу
onLinkRestored(() => void flushUnsent())
