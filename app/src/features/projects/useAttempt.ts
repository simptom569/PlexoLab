import { useState } from 'react'
import { errorText } from './api'

/**
 * Выполняет действие и хранит текст его ошибки. Состояние у каждого места своё (форма, строка списка), поэтому ошибка
 * показывается рядом с кнопкой, а не внизу окна, куда при длинном списке надо прокручивать.
 */
export function useAttempt() {
  const [problem, setProblem] = useState<string | null>(null)
  const run = async (work: () => Promise<void>) => {
    setProblem(null)
    try {
      await work()
    } catch (e) {
      setProblem(errorText(e))
    }
  }
  return { problem, run, clear: () => setProblem(null) }
}
