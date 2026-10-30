// Допуск сравнения с эталоном design/screenshots (docs/ROADMAP.md, этап 1).

/** Допустимая доля отличающихся пикселей: меньше 0,5% */
export const MAX_DIFF_RATIO = 0.005

/** Чувствительность pixelmatch к цвету (0..1). Пиксели сглаживания шрифта и краёв не считаются (includeAA: false). */
export const PIXEL_THRESHOLD = 0.1
