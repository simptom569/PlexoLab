import type { ScrollbarMode } from './settings'

/** Сколько полоса остаётся видной после прокрутки в режиме «тихие» */
export const SCROLL_REVEAL_MS = 900

/** Есть ли у элемента прокрутка по какой-то из осей: только такие блоки показывают полосу при наведении */
function isScroller(el: Element): boolean {
  const style = getComputedStyle(el)
  const scrolls = (overflow: string) => overflow === 'auto' || overflow === 'scroll'
  return (scrolls(style.overflowY) && el.scrollHeight > el.clientHeight) || (scrolls(style.overflowX) && el.scrollWidth > el.clientWidth)
}

/**
 * Включает режим полос прокрутки: атрибут data-scrollbars на <html> (по нему работает scrollbar.css). Для «тихих»
 * дополнительно помечает блоки: data-scroll-hover на прокручиваемых блоках под курсором и data-scrolling на том, что
 * только что прокрутили. CSS не умеет «курсор над блоком» для ползунка: :hover в правилах полосы значит «курсор над самой
 * полосой». Возвращает отмену.
 */
export function applyScrollbars(mode: ScrollbarMode): () => void {
  const root = document.documentElement
  root.dataset.scrollbars = mode
  if (mode !== 'quiet') {
    return () => {
      delete root.dataset.scrollbars
    }
  }

  const timers = new Map<Element, ReturnType<typeof setTimeout>>()
  const mark = (el: Element) => {
    el.setAttribute('data-scrolling', '')
    clearTimeout(timers.get(el))
    timers.set(
      el,
      setTimeout(() => {
        el.removeAttribute('data-scrolling')
        timers.delete(el)
      }, SCROLL_REVEAL_MS),
    )
  }
  // событие scroll не всплывает, но перехватывается на документе; прокрутка самого окна приходит от документа
  const onScroll = (e: Event) => {
    if (e.target instanceof Element) mark(e.target)
    else {
      mark(root)
      mark(document.body)
    }
  }

  let hovered: Element[] = []
  const setHovered = (next: Element[]) => {
    for (const el of hovered) if (!next.includes(el)) el.removeAttribute('data-scroll-hover')
    for (const el of next) el.setAttribute('data-scroll-hover', '')
    hovered = next
  }
  const onOver = (e: Event) => {
    const under: Element[] = []
    for (let el = e.target instanceof Element ? e.target : null; el && el !== root; el = el.parentElement) {
      if (isScroller(el)) under.push(el)
    }
    setHovered(under)
  }
  const onLeaveWindow = () => setHovered([])

  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  document.addEventListener('pointerover', onOver, { passive: true })
  document.documentElement.addEventListener('pointerleave', onLeaveWindow, { passive: true })
  return () => {
    document.removeEventListener('scroll', onScroll, { capture: true })
    document.removeEventListener('pointerover', onOver)
    document.documentElement.removeEventListener('pointerleave', onLeaveWindow)
    setHovered([])
    for (const [el, timer] of timers) {
      clearTimeout(timer)
      el.removeAttribute('data-scrolling')
    }
    delete root.dataset.scrollbars
  }
}
