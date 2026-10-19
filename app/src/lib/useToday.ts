import { useEffect, useState } from 'react'
import { todayIso } from './date'

/** Сегодняшняя дата `ГГГГ-ММ-ДД` по часам компьютера; сама меняется в полночь, если окно открыто всю ночь */
export function useToday(): string {
  const [today, setToday] = useState(() => todayIso())
  useEffect(() => {
    const now = new Date()
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
    const timer = setTimeout(() => setToday(todayIso()), midnight - now.getTime() + 1000)
    return () => clearTimeout(timer)
  }, [today])
  return today
}
