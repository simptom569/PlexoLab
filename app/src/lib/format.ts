/** Размер файла: «1.4 МБ», «12 КБ» (sz в макете) */
export const formatSize = (bytes: number): string =>
  bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`
