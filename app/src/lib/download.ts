import { api } from './api/client'
import { useToast } from './toast'

/** Сохраняет содержимое под нужным именем: браузер или окно приложения кладут его в «Загрузки» */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  // браузеру нужна секунда, чтобы начать скачивание, после этого адрес не нужен
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const DOWNLOAD_FAILED = 'Не удалось скачать файл'

/** Скачивает файл с сервера. Если не вышло (нет содержимого, пропала связь), показывает плашку. */
export async function downloadFile(file: { id: string; name: string }): Promise<void> {
  try {
    saveBlob(await api.download(`/files/${file.id}/download`), file.name)
  } catch {
    useToast.getState().show(DOWNLOAD_FAILED)
  }
}
