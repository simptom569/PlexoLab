// Подсветка кода в отрисованном блоке ```язык. В макете её нет, добавлена по просьбе владельца.
// Разбор делает lowlight (обёртка над highlight.js, без своих стилей и цветов), цвета лежат в styles/syntax.css.

import dockerfile from 'highlight.js/lib/languages/dockerfile'
import powershell from 'highlight.js/lib/languages/powershell'
import type { RootContent } from 'hast'
import { common, createLowlight } from 'lowlight'

/** Кусок кода: просто текст или группа с классами highlight.js (`hljs-keyword`, `hljs-title function_`), внутри могут быть вложенные */
export type CodeNode = string | { cls: string; nodes: CodeNode[] }

// 37 языков из набора `common` (js, ts, python, bash, sql, json, rust, css, xml, yaml, markdown, go, java ...) и два своих.
// Псевдонимы (`js`, `ts`, `py`, `sh`, `yml`, `rs`, `html`, `toml`, `ps1`) библиотека знает сама.
const lowlight = createLowlight({ ...common, dockerfile, powershell })

/** Длиннее не красим: разбор большого куска может занять заметное время, а читать такой блок глазами всё равно трудно */
export const MAX_HIGHLIGHT = 20_000

const convert = (node: RootContent): CodeNode => {
  if (node.type === 'text') return node.value
  if (node.type !== 'element') return ''
  return { cls: (node.properties.className as string[] | undefined)?.join(' ') ?? '', nodes: node.children.map(convert) }
}

/**
 * Разбирает код на цветные куски. `null` — красить не надо: язык не указан или неизвестен (как в Telegram, язык
 * не угадывается), блок слишком длинный или разбор не удался. Текст в кусках всегда складывается в исходный код.
 */
export function highlightCode(code: string, lang: string): CodeNode[] | null {
  const name = lang.trim().toLowerCase()
  if (!name || code.length > MAX_HIGHLIGHT || !lowlight.registered(name)) return null
  try {
    return lowlight.highlight(name, code).children.map(convert)
  } catch {
    // сбой в описании языка не должен ронять весь редактор: блок покажется без цвета
    return null
  }
}
