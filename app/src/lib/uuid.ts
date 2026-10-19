/**
 * Новый идентификатор вида uuid v4. Объекты холста получают его на клиенте: стрелки ссылаются на них, а весь холст
 * сохраняется одним запросом. `crypto.randomUUID` есть не везде (нужен защищённый контекст), поэтому запасной путь
 * через `getRandomValues`, который работает всегда.
 */
export function newId(): string {
  const c = globalThis.crypto
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  const b = c.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40 // версия 4
  b[8] = (b[8]! & 0x3f) | 0x80 // вариант RFC 4122
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'))
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`
}
