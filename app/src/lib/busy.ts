// Что сейчас нельзя прерывать обновлением данных с сервера: пока человек тащит карточку, перечитанная доска
// «выдернула» бы её из-под указателя. Чужие изменения при этом не теряются, а ждут (lib/realtime/invalidator.ts).

const holders = new Set<string>()

/** `who` занимает экран (или освобождает его): например, 'drag' на время переноса */
export function setBusy(who: string, busy: boolean): void {
  if (busy) holders.add(who)
  else holders.delete(who)
}

export const isBusy = (): boolean => holders.size > 0
