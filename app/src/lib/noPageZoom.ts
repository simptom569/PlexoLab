// Приложение — не страница в браузере: окно целиком не масштабируется ни колесом с Ctrl, ни сочетаниями клавиш, ни щипком.
// В собранном приложении это уже выключено настройкой окна (zoomHotkeysEnabled: false в src-tauri/tauri.conf.json), а здесь
// то же самое для режима разработки в браузере и для тестов, где окно иначе увеличивалось бы. Масштаб холста документа
// (features/docs/useCanvasView.ts) и поля с колесом работают сами: событие до них доходит, отменяется только действие по
// умолчанию.

/** Блокирует масштаб страницы: колесо с Ctrl и Ctrl + «+», «−», «0» (в том числе на цифровой клавиатуре) */
export function blockPageZoom(): void {
  window.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey) e.preventDefault()
    },
    { passive: false },
  )
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && ['+', '=', '-', '_', '0'].includes(e.key)) e.preventDefault()
  })
}
