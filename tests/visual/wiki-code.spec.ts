// Подсветка кода в блоке ```язык. В макете её нет, поэтому эталонных снимков нет: проверяем цвета в живом окне и
// снимаем свои снимки в обеих темах. Что именно красит библиотека, разобрано юнит-тестами (lib/markdown/highlight.test.ts).

import { expect, test } from '@playwright/test'
import { resetData } from './fixtures'
import { blocks, editor, expectSaved, makePage, openPageById } from './wiki-helpers'

test.beforeEach(() => resetData())

const TS = 'const total: number = 42 // сумма\nfunction run(name: string) {\n  return `привет, ${name}`\n}'

const fence = (lang: string, code: string) => '```' + lang + '\n' + code + '\n```'

// цвета из переменных макета: --debt-fg, --ok, --muted
const KEYWORD = { light: 'rgb(86, 56, 166)', dark: 'rgb(205, 189, 255)' }
const STRING = { light: 'rgb(23, 113, 76)', dark: 'rgb(76, 195, 138)' }
const COMMENT = { light: 'rgb(88, 96, 114)', dark: 'rgb(154, 163, 181)' }

const color = (el: ReturnType<typeof blocks>) => el.evaluate((n) => getComputedStyle(n).color)

for (const theme of ['light', 'dark'] as const) {
  test.describe(`подсветка (${theme})`, () => {
    test('ключевые слова, строки и комментарии красятся цветами макета', async ({ page }) => {
      const id = await makePage(page, 'Код', fence('ts', TS))
      await openPageById(page, id, theme)
      const code = page.locator('.md-code code')
      await expect(code.locator('.hljs-keyword').first()).toHaveText('const')
      expect(await color(code.locator('.hljs-keyword').first())).toBe(KEYWORD[theme])
      expect(await color(code.locator('.hljs-string'))).toBe(STRING[theme])
      expect(await color(code.locator('.hljs-comment'))).toBe(COMMENT[theme])
    })

    test('снимок блоков кода', async ({ page }) => {
      const md = [
        fence('ts', TS),
        fence('python', 'def render(items):\n    # собираем строки\n    return ", ".join(str(i) for i in items if i > 0)'),
        fence('sql', "SELECT id, title FROM tasks\nWHERE status = 'done' AND points > 3\nORDER BY created_at DESC;"),
        fence('json', '{ "name": "PlexoLab", "tags": ["team", "wiki"], "stable": true, "port": 8080 }'),
        fence('bash', 'cargo run --bin seed && echo "готово: $HOME"'),
        fence('', 'без языка: цвета нет'),
      ].join('\n\n')
      const id = await makePage(page, 'Снимок кода', md)
      await openPageById(page, id, theme)
      await expect(page.locator('.md-code')).toHaveCount(6)
      await page.mouse.move(8, 8)
      await expect(page.locator('.md')).toHaveScreenshot(`code-highlight-${theme}.png`)
    })
  })
}

test.describe('подсветка: поведение', () => {
  test('текст в блоке тот же, что в записи: цвет ничего не добавляет и не убирает', async ({ page }) => {
    const id = await makePage(page, 'Код', fence('ts', TS))
    await openPageById(page, id)
    await expect(page.locator('.md-code .hljs-keyword').first()).toBeVisible()
    await expect(page.locator('.md-code code')).toHaveText(TS)
  })

  test('без языка и с неизвестным языком цвета нет, подпись языка остаётся', async ({ page }) => {
    const id = await makePage(page, 'Без цвета', [fence('', 'const a = 1'), fence('nope', 'const b = 2')].join('\n\n'))
    await openPageById(page, id)
    await expect(page.locator('.md-code')).toHaveCount(2)
    await expect(page.locator('.md-code span[class^="hljs-"]')).toHaveCount(0)
    await expect(page.locator('.md-lang')).toHaveText('nope')
  })

  test('псевдонимы работают без правок: js, py, sh, yml', async ({ page }) => {
    const md = [fence('js', 'const a = 1'), fence('py', 'def f():\n    return 1'), fence('sh', 'echo $HOME'), fence('yml', 'name: value')].join('\n\n')
    const id = await makePage(page, 'Псевдонимы', md)
    await openPageById(page, id)
    for (let i = 0; i < 4; i++) await expect(page.locator('.md-code').nth(i).locator('span[class^="hljs-"]').first()).toBeVisible()
  })

  test('клик по цветному блоку открывает его для правки с исходным текстом, Esc ничего не портит', async ({ page }) => {
    const md = fence('ts', TS)
    const id = await makePage(page, 'Правка', md)
    await openPageById(page, id)
    await page.locator('.md-code .hljs-keyword').first().click()
    await expect(editor(page)).toHaveValue(md)
    await expect(page.locator('.md-code')).toHaveCount(0) // пока блок открыт, он обычное поле ввода
    await page.keyboard.press('Escape')
    await expect(editor(page)).toHaveCount(0)
    await expect(page.locator('.md-code .hljs-keyword').first()).toHaveText('const')
    await expectSaved(page, id, md)
  })

  test('дописали язык: блок после выхода из правки становится цветным', async ({ page }) => {
    const id = await makePage(page, 'Дописали', fence('', 'const a = 1'))
    await openPageById(page, id)
    await expect(page.locator('.md-code span[class^="hljs-"]')).toHaveCount(0)
    await blocks(page).first().click()
    await editor(page).fill(fence('js', 'const a = 1'))
    await page.keyboard.press('Escape')
    await expect(page.locator('.md-code .hljs-keyword')).toHaveText('const')
    await expect(page.locator('.md-lang')).toHaveText('js')
  })
})
