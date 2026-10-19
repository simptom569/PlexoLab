import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import pixelmatch from 'pixelmatch'
import pngjs from 'pngjs'
import { PIXEL_THRESHOLD } from './tolerance'

const { PNG } = pngjs

export type Rect = { x: number; y: number; width: number; height: number }

/** Эталонные снимки макета (только чтение) */
export const REFERENCE_DIR = path.resolve(import.meta.dirname, '../../design/screenshots')
const OUTPUT_DIR = path.resolve(import.meta.dirname, 'output')

function crop(png: InstanceType<typeof PNG>, r: Rect) {
  const out = new PNG({ width: r.width, height: r.height })
  PNG.bitblt(png, out, r.x, r.y, r.width, r.height, 0, 0)
  return out
}

function paint(png: InstanceType<typeof PNG>, r: Rect, rgba: [number, number, number, number]) {
  for (let y = r.y; y < r.y + r.height; y++) {
    for (let x = r.x; x < r.x + r.width; x++) {
      const i = (png.width * y + x) << 2
      png.data[i] = rgba[0]
      png.data[i + 1] = rgba[1]
      png.data[i + 2] = rgba[2]
      png.data[i + 3] = rgba[3]
    }
  }
}

type CompareArgs = {
  /** PNG-снимок области `region` (page.screenshot с clip) */
  actual: Buffer
  /** Имя файла в design/screenshots, например 01-board-light.png */
  referenceFile: string
  /** Область эталона, которую сравниваем */
  region: Rect
  /** Прямоугольники (в координатах области), которые заведомо отличаются и не сравниваются */
  ignore?: Rect[]
  /** Имя для файлов с результатом в tests/visual/output */
  name: string
}

/** Сравнивает снимок приложения с областью эталона. Возвращает долю отличающихся пикселей. */
export function compareToReference({ actual, referenceFile, region, ignore = [], name }: CompareArgs) {
  const shot = PNG.sync.read(actual)
  const ref = crop(PNG.sync.read(readFileSync(path.join(REFERENCE_DIR, referenceFile))), region)
  if (shot.width !== region.width || shot.height !== region.height) {
    throw new Error(`Размер снимка ${shot.width}×${shot.height} не совпадает с областью ${region.width}×${region.height}`)
  }
  for (const r of ignore) {
    paint(shot, r, [255, 0, 255, 255])
    paint(ref, r, [255, 0, 255, 255])
  }
  const diff = new PNG({ width: region.width, height: region.height })
  const diffPixels = pixelmatch(ref.data, shot.data, diff.data, region.width, region.height, {
    threshold: PIXEL_THRESHOLD,
    includeAA: false,
  })
  mkdirSync(OUTPUT_DIR, { recursive: true })
  writeFileSync(path.join(OUTPUT_DIR, `${name}-actual.png`), PNG.sync.write(shot))
  writeFileSync(path.join(OUTPUT_DIR, `${name}-reference.png`), PNG.sync.write(ref))
  writeFileSync(path.join(OUTPUT_DIR, `${name}-diff.png`), PNG.sync.write(diff))
  const total = region.width * region.height
  return { diffPixels, total, diffRatio: diffPixels / total }
}
