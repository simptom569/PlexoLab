import { describe, expect, it } from 'vitest'
import { MAX_HIGHLIGHT, highlightCode, type CodeNode } from './highlight'

/** Весь текст из кусков, в том же порядке */
const textOf = (nodes: CodeNode[]): string => nodes.map((n) => (typeof n === 'string' ? n : textOf(n.nodes))).join('')

/** Классы всех групп, в которых лежит `needle` (с самой внутренней) */
const classesOf = (nodes: CodeNode[], needle: string, path: string[] = []): string[] | null => {
  for (const n of nodes) {
    if (typeof n === 'string') {
      if (n.includes(needle)) return path
    } else {
      const found = classesOf(n.nodes, needle, [...path, n.cls])
      if (found) return found
    }
  }
  return null
}

const ts = 'const x: number = 1 // тут\nlet s = `a${x}`'

describe('highlightCode: цвета', () => {
  it('ключевые слова, числа, комментарии и строки получают классы highlight.js', () => {
    const nodes = highlightCode(ts, 'ts')!
    expect(classesOf(nodes, 'const')).toEqual(['hljs-keyword'])
    expect(classesOf(nodes, '1')).toEqual(['hljs-number'])
    expect(classesOf(nodes, '// тут')).toEqual(['hljs-comment'])
    expect(classesOf(nodes, '`a')).toEqual(['hljs-string'])
  })

  it('вложенные группы остаются вложенными: подстановка внутри строки', () => {
    expect(classesOf(highlightCode(ts, 'ts')!, '${x}')).toEqual(['hljs-string', 'hljs-subst'])
  })

  it('у названия функции два класса: hljs-title function_', () => {
    expect(classesOf(highlightCode('def render(a):\n    return 1', 'py')!, 'render')).toEqual(['hljs-title function_'])
  })

  it('текст кусков складывается ровно в исходный код (пробелы, переносы, кириллица)', () => {
    const cases: [string, string][] = [
      [ts, 'ts'],
      ['SELECT id FROM tasks\n\n  WHERE title = \'Привет\'', 'sql'],
      ['{"a": [1, true, null]}', 'json'],
      ['cargo run --bin seed && echo $HOME', 'sh'],
      ['<div class="a">текст</div>', 'html'],
      ['  \n\t', 'rust'],
    ]
    for (const [code, lang] of cases) expect(textOf(highlightCode(code, lang)!)).toBe(code)
  })
})

describe('highlightCode: язык', () => {
  it('псевдонимы библиотека знает сама, регистр не важен', () => {
    const code = 'const a = 1'
    const want = highlightCode(code, 'javascript')
    expect(want).not.toBeNull()
    for (const alias of ['js', 'JS', ' js ']) expect(highlightCode(code, alias)).toEqual(want)
    for (const alias of ['ts', 'py', 'sh', 'yml', 'rs', 'html', 'toml', 'ps1', 'docker', 'golang', 'md']) {
      expect(highlightCode('x', alias), alias).not.toBeNull()
    }
  })

  it('PowerShell и Dockerfile добавлены сверх набора common', () => {
    expect(classesOf(highlightCode('Get-ChildItem -Recurse', 'powershell')!, 'Get-ChildItem')).toEqual(['hljs-built_in'])
    expect(classesOf(highlightCode('FROM node:22', 'dockerfile')!, 'FROM')).toEqual(['hljs-keyword'])
  })

  it('без языка или с неизвестным — не красим, язык не угадывается', () => {
    expect(highlightCode('const a = 1', '')).toBeNull()
    expect(highlightCode('const a = 1', '   ')).toBeNull()
    expect(highlightCode('const a = 1', 'nope')).toBeNull()
  })

  it('строка из макета ```bash make release остаётся без цвета: эталонные снимки не меняются', () => {
    expect(highlightCode('make release', 'bash')).toEqual(['make release'])
  })

  it('слишком длинный блок не красим', () => {
    expect(highlightCode('a'.repeat(MAX_HIGHLIGHT), 'js')).not.toBeNull()
    expect(highlightCode('a'.repeat(MAX_HIGHLIGHT + 1), 'js')).toBeNull()
  })
})
