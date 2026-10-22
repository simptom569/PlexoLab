import { describe, expect, it } from 'vitest'
import {
  EDGE_SPEED, EDGE_ZONE, HOME, MAX_COORD, MAX_ZOOM, MIN_ZOOM, clampCoord, clampZoom, contains, edgeVelocity, fitCamera, gridStyle, panBy,
  revealCamera, snap, tidy, toScreen, toWorld, visibleRect, wheelPan, wheelZoomFactor, zoomBy, zoomTo, type Camera,
} from './camera'

const VIEW = { w: 1000, h: 600 }

describe('перевод координат', () => {
  it('в покое холст и окно совпадают', () => {
    expect(toWorld(HOME, { x: 120, y: 45 })).toEqual({ x: 120, y: 45 })
    expect(toScreen(HOME, { x: 120, y: 45 })).toEqual({ x: 120, y: 45 })
  })

  it('туда и обратно возвращает ту же точку при любой камере', () => {
    const c: Camera = { x: -340, y: 75, z: 0.5 }
    const world = { x: 910, y: -120 }
    const back = toWorld(c, toScreen(c, world))
    expect(back.x).toBeCloseTo(world.x, 9)
    expect(back.y).toBeCloseTo(world.y, 9)
  })

  it('сдвиг и масштаб входят так: точка холста * z + сдвиг', () => {
    expect(toScreen({ x: 100, y: 50, z: 2 }, { x: 10, y: 10 })).toEqual({ x: 120, y: 70 })
  })
})

describe('масштаб', () => {
  it('держится между 25% и 200%', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM)
    expect(clampZoom(9)).toBe(MAX_ZOOM)
    expect(clampZoom(1.3)).toBe(1.3)
  })

  it('вокруг точки: она остаётся над тем же местом холста', () => {
    const c: Camera = { x: 30, y: -10, z: 1 }
    const at = { x: 400, y: 250 }
    const before = toWorld(c, at)
    for (const factor of [1.25, 0.8, 1.5, 0.5]) {
      const next = zoomBy(c, factor, at)
      const after = toWorld(next, at)
      expect(after.x).toBeCloseTo(before.x, 9)
      expect(after.y).toBeCloseTo(before.y, 9)
    }
  })

  it('на пределе камера не меняется (и точка не уезжает)', () => {
    const maxed: Camera = { x: 5, y: 6, z: MAX_ZOOM }
    expect(zoomBy(maxed, 1.5, { x: 100, y: 100 })).toBe(maxed)
    const min: Camera = { x: 5, y: 6, z: MIN_ZOOM }
    expect(zoomBy(min, 0.5, { x: 100, y: 100 })).toBe(min)
  })

  it('zoomTo(1) возвращает 100% вокруг точки', () => {
    const c: Camera = { x: 0, y: 0, z: 0.5 }
    const next = zoomTo(c, 1, { x: 200, y: 100 })
    expect(next.z).toBe(1)
    expect(toWorld(next, { x: 200, y: 100 })).toEqual(toWorld(c, { x: 200, y: 100 }))
  })

  it('колесо: вперёд приближает, назад отдаляет, на пустой щелчок ничего', () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1)
    expect(wheelZoomFactor(100)).toBeLessThan(1)
    expect(wheelZoomFactor(0)).toBe(1)
    expect(wheelZoomFactor(-100) * wheelZoomFactor(100)).toBeCloseTo(1, 12)
  })
})

describe('колесо двигает холст', () => {
  const wheel = (deltaX: number, deltaY: number, extra: Partial<{ deltaMode: number; shiftKey: boolean }> = {}) => ({
    deltaX, deltaY, deltaMode: 0, shiftKey: false, ...extra,
  })

  it('вниз по колесу содержимое уезжает вверх', () => {
    expect(wheelPan(wheel(0, 100), VIEW)).toEqual({ x: 0, y: -100 })
    expect(wheelPan(wheel(30, -20), VIEW)).toEqual({ x: -30, y: 20 })
  })

  it('с Shift вертикальное колесо двигает по горизонтали', () => {
    expect(wheelPan(wheel(0, 100, { shiftKey: true }), VIEW)).toEqual({ x: -100, y: 0 })
    // тачпад уже даёт горизонталь сам: Shift ничего не переставляет
    expect(wheelPan(wheel(40, 10, { shiftKey: true }), VIEW)).toEqual({ x: -40, y: -10 })
  })

  it('строки и страницы переводятся в пиксели', () => {
    expect(wheelPan(wheel(0, 3, { deltaMode: 1 }), VIEW)).toEqual({ x: 0, y: -48 })
    expect(wheelPan(wheel(1, 1, { deltaMode: 2 }), VIEW)).toEqual({ x: -1000, y: -600 })
  })
})

describe('автопрокрутка у края', () => {
  it('в середине окна холст стоит', () => {
    expect(edgeVelocity({ x: 500, y: 300 }, VIEW)).toEqual({ x: 0, y: 0 })
    expect(edgeVelocity({ x: EDGE_ZONE, y: VIEW.h - EDGE_ZONE }, VIEW)).toEqual({ x: 0, y: 0 })
  })

  it('у правого и нижнего края содержимое едет влево и вверх, у левого и верхнего вправо и вниз', () => {
    expect(edgeVelocity({ x: 990, y: 300 }, VIEW).x).toBeLessThan(0)
    expect(edgeVelocity({ x: 10, y: 300 }, VIEW).x).toBeGreaterThan(0)
    expect(edgeVelocity({ x: 500, y: 595 }, VIEW).y).toBeLessThan(0)
    expect(edgeVelocity({ x: 500, y: 5 }, VIEW).y).toBeGreaterThan(0)
  })

  it('чем ближе к краю, тем быстрее; за краем скорость наибольшая и не растёт', () => {
    const slow = Math.abs(edgeVelocity({ x: 1000 - EDGE_ZONE / 2, y: 300 }, VIEW).x)
    const fast = Math.abs(edgeVelocity({ x: 999, y: 300 }, VIEW).x)
    expect(fast).toBeGreaterThan(slow)
    expect(edgeVelocity({ x: 1000, y: 300 }, VIEW).x).toBe(-EDGE_SPEED)
    expect(edgeVelocity({ x: 5000, y: 300 }, VIEW).x).toBe(-EDGE_SPEED)
    expect(edgeVelocity({ x: -5000, y: 300 }, VIEW).x).toBe(EDGE_SPEED)
  })
})

describe('видимая часть и «Показать всё»', () => {
  it('видимая часть: по камере и размеру окна', () => {
    expect(visibleRect(HOME, VIEW)).toEqual({ x: 0, y: 0, w: 1000, h: 600 })
    expect(visibleRect({ x: -200, y: -100, z: 0.5 }, VIEW)).toEqual({ x: 400, y: 200, w: 2000, h: 1200 })
  })

  it('contains: целиком внутри, касание края допустимо', () => {
    const outer = { x: 0, y: 0, w: 100, h: 100 }
    expect(contains(outer, { x: 10, y: 10, w: 90, h: 90 })).toBe(true)
    expect(contains(outer, { x: 10, y: 10, w: 91, h: 90 })).toBe(false)
    expect(contains(outer, { x: -1, y: 0, w: 10, h: 10 })).toBe(false)
  })

  it('небольшое содержимое ставится по центру в масштабе 100%, а не раздувается', () => {
    const c = fitCamera({ x: 100, y: 100, w: 200, h: 100 }, VIEW)
    expect(c.z).toBe(1)
    const centre = toScreen(c, { x: 200, y: 150 })
    expect(centre).toEqual({ x: 500, y: 300 })
  })

  it('большое содержимое уменьшается до окна, с отступом, по центру', () => {
    const bounds = { x: -1000, y: -500, w: 4000, h: 2000 }
    const c = fitCamera(bounds, VIEW)
    expect(c.z).toBeCloseTo(0.25, 5)
    const tl = toScreen(c, { x: bounds.x, y: bounds.y })
    const br = toScreen(c, { x: bounds.x + bounds.w, y: bounds.y + bounds.h })
    expect(tl.x).toBeGreaterThanOrEqual(0)
    expect(br.x).toBeLessThanOrEqual(VIEW.w)
    expect(tl.y).toBeGreaterThanOrEqual(0)
    expect(br.y).toBeLessThanOrEqual(VIEW.h)
  })

  it('совсем огромное содержимое упирается в 25%', () => {
    expect(fitCamera({ x: 0, y: 0, w: 50_000, h: 50_000 }, VIEW).z).toBe(MIN_ZOOM)
  })

  it('пустое место нулевого размера не ломает расчёт', () => {
    const c = fitCamera({ x: 10, y: 10, w: 0, h: 0 }, VIEW)
    expect(Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z)).toBe(true)
  })
})

describe('показать объект, которого не видно', () => {
  it('виден целиком: камера та же самая', () => {
    expect(revealCamera(HOME, { x: 100, y: 100, w: 50, h: 50 }, VIEW)).toBe(HOME)
  })

  it('ушёл вправо или вниз: сдвиг на минимум, с отступом', () => {
    const c = revealCamera(HOME, { x: 1100, y: 700, w: 100, h: 50 }, VIEW, 24)
    expect(c.x).toBe(-(1100 + 100 - (1000 - 24)))
    expect(c.y).toBe(-(700 + 50 - (600 - 24)))
  })

  it('ушёл влево или вверх', () => {
    const c = revealCamera(HOME, { x: -300, y: -50, w: 100, h: 40 }, VIEW, 24)
    expect(c.x).toBe(324)
    expect(c.y).toBe(74)
  })

  it('больше окна: прижимается левым краем, а не прячет начало', () => {
    const c = revealCamera(HOME, { x: 500, y: 100, w: 2000, h: 50 }, VIEW, 24)
    expect(500 + c.x).toBe(24)
  })
})

describe('мелочи', () => {
  it('snap округляет сдвиг до целых и не трогает масштаб', () => {
    expect(snap({ x: 10.4, y: -3.6, z: 0.75 })).toEqual({ x: 10, y: -4, z: 0.75 })
  })

  it('panBy сдвигает, масштаб остаётся', () => {
    expect(panBy({ x: 1, y: 2, z: 1.5 }, 10, -5)).toEqual({ x: 11, y: -3, z: 1.5 })
  })

  it('tidy оставляет сотые', () => {
    expect(tidy(500.00000000000006)).toBe(500)
    expect(tidy(123.4567)).toBe(123.46)
  })

  it('clampCoord держится в пределах сервера', () => {
    expect(clampCoord(5e6)).toBe(MAX_COORD)
    expect(clampCoord(-5e6)).toBe(-MAX_COORD)
    expect(clampCoord(-250.5)).toBe(-250.5)
  })

  it('сетка: на 100% шаг 22, на малом масштабе точки редеют вдвое и остаются кратными', () => {
    expect(gridStyle(HOME)).toEqual({ size: 22, x: 0, y: 0 })
    expect(gridStyle({ x: 7, y: 9, z: 0.5 })).toEqual({ size: 22, x: 7, y: 9 })
    expect(gridStyle({ x: 0, y: 0, z: 0.25 }).size).toBe(22)
    expect(gridStyle({ x: 0, y: 0, z: 2 }).size).toBe(44)
    // никогда не мельче 12 пикселей
    for (const z of [0.25, 0.3, 0.4, 0.55, 0.7, 1, 1.4, 2]) expect(gridStyle({ x: 0, y: 0, z }).size).toBeGreaterThanOrEqual(12)
  })
})
