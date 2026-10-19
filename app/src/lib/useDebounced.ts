import { useEffect, useState } from 'react'

/** Значение, которое догоняет `value` через `delay` мс после последнего изменения (поиск, который ходит на сервер) */
export function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
