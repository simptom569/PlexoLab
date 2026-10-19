// Адрес сервера, который вводит человек: «192.168.1.10:8080», «https://plexolab.example.com/» и т. п.

export type ServerCandidates =
  | { ok: true; /** В порядке предпочтения: сначала https, потом http */ urls: string[] }
  | { ok: false; reason: string }

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

/** Приводит адрес к виду `схема://хост[:порт]` без пути и слэша в конце */
export function originOf(input: string): string | null {
  try {
    const u = new URL(input)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname) return null
    return u.origin
  } catch {
    return null
  }
}

/**
 * Что пробовать по введённому адресу. Со схемой (`http://...`, `https://...`) берётся именно она.
 * Без схемы пробуются обе: сервер может стоять и на http, и на https.
 */
export function serverCandidates(raw: string): ServerCandidates {
  const text = raw.trim()
  if (!text) return { ok: false, reason: 'Введите адрес сервера' }
  if (SCHEME.test(text)) {
    const origin = originOf(text)
    if (!origin) return { ok: false, reason: 'Адрес должен начинаться с http:// или https://' }
    return { ok: true, urls: [origin] }
  }
  if (/\s/.test(text) || text.includes('://')) return { ok: false, reason: 'В адресе есть лишние символы' }
  const https = originOf(`https://${text}`)
  const http = originOf(`http://${text}`)
  if (!https || !http) return { ok: false, reason: 'Адрес не похож на адрес сервера' }
  return { ok: true, urls: [https, http] }
}

/** Адрес без схемы для показа: `192.168.1.10:8080` */
export function shortServerName(url: string): string {
  return url.replace(SCHEME, '')
}
