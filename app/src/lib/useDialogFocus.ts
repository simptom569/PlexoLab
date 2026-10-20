import { useEffect, type RefObject } from 'react'

const FOCUSABLE = 'a[href],button,input,textarea,select,[tabindex]'

/**
 * Фокус окна: при открытии уходит внутрь, Tab не выходит наружу, Esc закрывает, при закрытии фокус возвращается.
 * `returnFocus` — куда вернуть фокус: окно открывает пункт меню, а меню к этому моменту уже закрыто и удалено,
 * поэтому «элемент, на котором был фокус» к открытию окна — это уже `body`.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, onEscape: () => void, returnFocus?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const opener = returnFocus?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    ;(dialog.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? dialog).focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onEscape()
        return
      }
      if (e.key !== 'Tab') return
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.tabIndex >= 0 && !el.hasAttribute('disabled'))
      if (!items.length) return e.preventDefault()
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (opener?.isConnected) opener.focus()
    }
  }, [ref, onEscape, returnFocus])
}
