// Пакетная пометка запросов устаревшими. События с сервера приходят пачками (одно действие даёт два-три события), а
// перечитывать одно и то же трижды незачем: ключи копятся короткое время и уходят одним разом. Пока идут свои правки
// или человек тащит карточку, перечитывание ждёт: иначе ответ сервера перетёр бы показанное до ответа (оптимистичное
// изменение) или выдернул карточку из-под указателя. Ждать вечно нельзя (загрузка большого файла идёт минутами),
// поэтому через `MAX_WAIT_MS` перечитывается всё равно.

import type { QueryKey } from '@tanstack/react-query'

/** Сколько копить события перед перечитыванием */
export const BATCH_MS = 150
/** Как часто проверять, освободился ли экран */
export const RETRY_MS = 250
/** Дольше этого перечитывание не откладывается */
export const MAX_WAIT_MS = 3_000

/** Всё, что нужно от QueryClient: пометить запросы устаревшими и перечитать те, что на экране */
export type Invalidates = { invalidateQueries: (filters: { queryKey: QueryKey }) => Promise<unknown> }

const isPrefix = (prefix: QueryKey, key: QueryKey): boolean =>
  prefix.length < key.length && prefix.every((part, i) => JSON.stringify(part) === JSON.stringify(key[i]))

/** Убирает ключи, которые уже закрыты более коротким: `['board']` покрывает `['board', id]`, `[]` покрывает всё */
export function dedupe(list: QueryKey[]): QueryKey[] {
  const unique = new Map(list.map((k) => [JSON.stringify(k), k] as const))
  const keys = [...unique.values()]
  return keys.filter((k) => !keys.some((other) => isPrefix(other, k)))
}

export class Invalidator {
  private readonly pending = new Map<string, QueryKey>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private waited = 0
  private readonly client: Invalidates
  private readonly busy: () => boolean

  constructor(client: Invalidates, busy: () => boolean) {
    this.client = client
    this.busy = busy
  }

  /** Запросы, которые надо перечитать. Пустой ключ `[]` означает «все». */
  add(list: QueryKey[]): void {
    if (list.length === 0) return
    for (const key of list) this.pending.set(JSON.stringify(key), key)
    if (this.timer === undefined) this.schedule(BATCH_MS)
  }

  /** Отменить всё ожидающее (вышли из приложения) */
  clear(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.pending.clear()
    this.waited = 0
  }

  private schedule(ms: number) {
    this.timer = setTimeout(() => this.run(), ms)
  }

  private run() {
    this.timer = undefined
    if (this.busy() && this.waited < MAX_WAIT_MS) {
      this.waited += RETRY_MS
      this.schedule(RETRY_MS)
      return
    }
    this.waited = 0
    const keys = dedupe([...this.pending.values()])
    this.pending.clear()
    for (const queryKey of keys) void this.client.invalidateQueries({ queryKey })
  }
}
