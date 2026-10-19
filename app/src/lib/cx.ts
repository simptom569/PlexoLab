/** Склеивает имена классов, пропуская пустые значения. */
export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')
