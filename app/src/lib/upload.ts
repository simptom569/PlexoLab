// Загрузка файлов: выбор в окне и отправка на сервер пачками.

import { api } from './api/client'

/** Файлов в одном запросе (так же ограничивает сервер): больше уходят несколькими запросами */
export const MAX_FILES_PER_UPLOAD = 50

/** Выбранные в окне файлы → в список; поле очищается, чтобы тот же файл можно было выбрать снова */
export function pickedFiles(input: HTMLInputElement): File[] {
  const files = Array.from(input.files ?? [])
  input.value = ''
  return files
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Загружает файлы формой multipart/form-data по `MAX_FILES_PER_UPLOAD` штук за запрос. `fields` (папка, страница)
 * добавляются в каждую форму. Возвращает созданные записи в порядке ответов сервера. Если одна пачка не прошла,
 * ошибка уходит наружу, а уже загруженные пачки остаются на сервере.
 */
export async function uploadInBatches<T>(path: string, files: File[], fields: Record<string, string | null | undefined> = {}): Promise<T[]> {
  const uploaded: T[] = []
  for (const part of chunk(files, MAX_FILES_PER_UPLOAD)) {
    const form = new FormData()
    for (const f of part) form.append('file', f, f.name)
    for (const [name, value] of Object.entries(fields)) if (value) form.append(name, value)
    uploaded.push(...(await api.upload<T[]>(path, form)))
  }
  return uploaded
}
