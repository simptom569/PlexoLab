import { expect, test, type Browser, type Page } from '@playwright/test'
import { docFull, makeDoc, openDoc } from './docs-helpers'
import { openApp, resetData } from './fixtures'
import { api, blocks, editor, expectSaved, makePage, openPageById, wikiPage } from './wiki-helpers'

// Слияние правок при конфликте версий (lib/merge.ts, PageDraft.merge): если два человека правили разные места, правки
// склеиваются, если одно и то же место, остаётся баннер «Оставить мою / Загрузить его» (его проверяют wiki-pages и docs-doc).
// Второй клиент «слепой»: настройка «Обновлять вживую» выключена, он не получает чужих изменений и держит старую версию,
// поэтому конфликт настоящий и не зависит от скорости событий.

test.beforeEach(() => resetData())

const THREE = 'Первый абзац\n\nВторой абзац\n\nТретий абзац'
const notice = (page: Page) => page.getByRole('status').filter({ hasText: 'Объединено' })

/** Второй человек (Артём) со страницей или документом; `live: false` — «слепой», со старой версией */
async function second(browser: Browser, settings: Record<string, unknown>, label: string, live: boolean): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU', timezoneId: 'UTC', reducedMotion: 'reduce' })
  const page = await context.newPage()
  await openApp(page, { email: 'artem@example.com', settings: { ...settings, live } })
  await expect(page.getByLabel(label)).toBeVisible()
  return { page, close: () => context.close() }
}

const blindSecond = (browser: Browser, settings: Record<string, unknown>, label: string) => second(browser, settings, label, false)
/** Второй человек, который получает чужие правки вживую */
const liveSecond = (browser: Browser, settings: Record<string, unknown>, label: string) => second(browser, settings, label, true)

test.describe('вики', () => {
  test('правки в разных абзацах склеиваются: баннера нет, обе правки на месте, есть уведомление', async ({ page, browser }) => {
    const id = await makePage(page, 'Слияние', THREE)
    await openPageById(page, id)
    const second = await blindSecond(browser, { page: 'wiki', wikiPage: id }, 'Название страницы')
    try {
      await blocks(page).nth(2).click()
      await page.keyboard.type(' (первый)')
      await page.keyboard.press('Escape')
      await expectSaved(page, id, 'Первый абзац\n\nВторой абзац\n\nТретий абзац (первый)')

      await blocks(second.page).nth(0).click()
      await second.page.keyboard.type(' (второй)')
      await second.page.keyboard.press('Escape')

      await expectSaved(page, id, 'Первый абзац (второй)\n\nВторой абзац\n\nТретий абзац (первый)')
      await expect(second.page.getByRole('alert')).toHaveCount(0)
      await expect(notice(second.page)).toHaveText('Объединено с правками: Лена М.')
      await expect(blocks(second.page)).toHaveText(['Первый абзац (второй)', 'Второй абзац', 'Третий абзац (первый)'])
      expect((await wikiPage(page, id)).rev).toBe(3)
    } finally {
      await second.close()
    }
  })

  test('чужой абзац добавлен выше: мой блок остаётся открытым, курсор на месте, печатать можно дальше', async ({ page, browser }) => {
    const id = await makePage(page, 'Сдвиг', THREE)
    await openPageById(page, id)
    const second = await blindSecond(browser, { page: 'wiki', wikiPage: id }, 'Название страницы')
    try {
      // кто-то добавил абзац в самое начало: у второго номера строк его блока сдвинутся
      const current = await wikiPage(page, id)
      await api(page, `/wiki/${id}`, { method: 'PATCH', data: { rev: current.rev, md: `Новый абзац\n\n${THREE}` } })

      await blocks(second.page).nth(2).click()
      await second.page.keyboard.type(' (второй)')
      await expect(notice(second.page)).toBeVisible()

      // редактор пересоздан, но тот же блок снова открыт и курсор в конце: набор продолжается без щелчка
      await expect(editor(second.page)).toBeFocused()
      await expect(editor(second.page)).toHaveValue('Третий абзац (второй)')
      await second.page.keyboard.type(' ещё')
      await second.page.keyboard.press('Escape')

      await expectSaved(page, id, 'Новый абзац\n\nПервый абзац\n\nВторой абзац\n\nТретий абзац (второй) ещё')
      await expect(second.page.getByRole('alert')).toHaveCount(0)
    } finally {
      await second.close()
    }
  })

  test('оба добавили новый блок в одно место: как в git, баннер, ничего не склеено', async ({ page, browser }) => {
    const id = await makePage(page, 'Спор о конце', THREE)
    await openPageById(page, id)
    const second = await blindSecond(browser, { page: 'wiki', wikiPage: id }, 'Название страницы')
    try {
      await page.locator('.md-add').click()
      await page.keyboard.type('Первый новый')
      await page.keyboard.press('Escape')
      await expectSaved(page, id, `${THREE}\n\nПервый новый`)

      await second.page.locator('.md-add').click()
      await second.page.keyboard.type('Второй новый')
      await second.page.keyboard.press('Escape')
      await expect(second.page.getByRole('alert')).toContainText('Страницу изменил другой участник')
      await expect(notice(second.page)).toHaveCount(0)
      expect((await wikiPage(page, id)).md).toBe(`${THREE}\n\nПервый новый`)
    } finally {
      await second.close()
    }
  })

  test('название меняет один, текст другой: оба на месте', async ({ page, browser }) => {
    const id = await makePage(page, 'Старое название', THREE)
    await openPageById(page, id)
    const second = await blindSecond(browser, { page: 'wiki', wikiPage: id }, 'Название страницы')
    try {
      await page.getByLabel('Название страницы').fill('Новое название')
      await expect.poll(async () => (await wikiPage(page, id)).title).toBe('Новое название')

      await blocks(second.page).nth(1).click()
      await second.page.keyboard.type(' (второй)')
      await second.page.keyboard.press('Escape')
      await expectSaved(page, id, 'Первый абзац\n\nВторой абзац (второй)\n\nТретий абзац')
      expect((await wikiPage(page, id)).title).toBe('Новое название')
      await expect(second.page.getByLabel('Название страницы')).toHaveValue('Новое название')
      await expect(second.page.getByRole('alert')).toHaveCount(0)
    } finally {
      await second.close()
    }
  })
})

// Чужая версия пришла вживую, а у меня нет несохранённых правок (я просто стою курсором в блоке): текст заменяется, но
// блок остаётся открытым. Раньше он закрывался, фокус пропадал, и всё, что человек печатал дальше, уходило в пустоту.
test.describe('чужая версия пришла вживую: мой открытый блок остаётся открытым', () => {
  test('вики: сосед сохранил другой абзац, пока я стою в блоке', async ({ page, browser }) => {
    const id = await makePage(page, 'Живой сосед', THREE)
    await openPageById(page, id)
    const other = await liveSecond(browser, { page: 'wiki', wikiPage: id }, 'Название страницы')
    try {
      await blocks(other.page).nth(0).click()
      await expect(editor(other.page)).toBeFocused()

      await blocks(page).nth(2).click()
      await page.keyboard.type(' (первый)')
      await page.keyboard.press('Escape')
      await expectSaved(page, id, 'Первый абзац\n\nВторой абзац\n\nТретий абзац (первый)')

      // у второго чужая правка уже на экране (она в отрисованных блоках), а его блок открыт, курсор в нём
      await expect(blocks(other.page)).toHaveText(['Второй абзац', 'Третий абзац (первый)'])
      await expect(editor(other.page)).toBeFocused()
      await expect(editor(other.page)).toHaveValue('Первый абзац')

      await other.page.keyboard.type(' (второй)')
      await other.page.keyboard.press('Escape')
      await expectSaved(page, id, 'Первый абзац (второй)\n\nВторой абзац\n\nТретий абзац (первый)')
    } finally {
      await other.close()
    }
  })

  test('вики: сосед добавил абзац выше, мой блок на новом месте', async ({ page, browser }) => {
    const id = await makePage(page, 'Сдвиг вживую', THREE)
    await openPageById(page, id)
    const other = await liveSecond(browser, { page: 'wiki', wikiPage: id }, 'Название страницы')
    try {
      await blocks(other.page).nth(2).click()
      await expect(editor(other.page)).toHaveValue('Третий абзац')

      const current = await wikiPage(page, id)
      await api(page, `/wiki/${id}`, { method: 'PATCH', data: { rev: current.rev, md: `Новый абзац\n\n${THREE}` } })

      await expect(blocks(other.page)).toHaveText(['Новый абзац', 'Первый абзац', 'Второй абзац'])
      await expect(editor(other.page)).toBeFocused()
      await expect(editor(other.page)).toHaveValue('Третий абзац')

      await other.page.keyboard.type(' (второй)')
      await other.page.keyboard.press('Escape')
      await expectSaved(page, id, 'Новый абзац\n\nПервый абзац\n\nВторой абзац\n\nТретий абзац (второй)')
    } finally {
      await other.close()
    }
  })

  test('документ: сосед сохранил другой абзац, пока я стою в блоке', async ({ page, browser }) => {
    const id = await makeDoc(page, 'Живой сосед', 'page', THREE)
    await openDoc(page, id)
    const other = await liveSecond(browser, { page: 'docs', docOpen: id }, 'Название документа')
    try {
      await blocks(other.page).nth(0).click()
      await expect(editor(other.page)).toBeFocused()

      await blocks(page).nth(2).click()
      await page.keyboard.type(' (первый)')
      await page.keyboard.press('Escape')
      await expect.poll(async () => (await docFull(page, id)).md, { timeout: 6000 }).toBe('Первый абзац\n\nВторой абзац\n\nТретий абзац (первый)')

      await expect(blocks(other.page)).toHaveText(['Второй абзац', 'Третий абзац (первый)'])
      await expect(editor(other.page)).toBeFocused()
      await expect(editor(other.page)).toHaveValue('Первый абзац')

      await other.page.keyboard.type(' (второй)')
      await other.page.keyboard.press('Escape')
      await expect.poll(async () => (await docFull(page, id)).md, { timeout: 6000 }).toBe('Первый абзац (второй)\n\nВторой абзац\n\nТретий абзац (первый)')
    } finally {
      await other.close()
    }
  })

  test('документ: сосед добавил абзац выше, мой блок на новом месте', async ({ page, browser }) => {
    const id = await makeDoc(page, 'Сдвиг вживую', 'page', THREE)
    await openDoc(page, id)
    const other = await liveSecond(browser, { page: 'docs', docOpen: id }, 'Название документа')
    try {
      await blocks(other.page).nth(2).click()
      await expect(editor(other.page)).toHaveValue('Третий абзац')

      const current = await docFull(page, id)
      await api(page, `/docs/${id}`, { method: 'PATCH', data: { rev: current.rev, md: `Новый абзац\n\n${THREE}` } })

      await expect(blocks(other.page)).toHaveText(['Новый абзац', 'Первый абзац', 'Второй абзац'])
      await expect(editor(other.page)).toBeFocused()
      await expect(editor(other.page)).toHaveValue('Третий абзац')

      await other.page.keyboard.type(' (второй)')
      await other.page.keyboard.press('Escape')
      await expect.poll(async () => (await docFull(page, id)).md, { timeout: 6000 }).toBe('Новый абзац\n\nПервый абзац\n\nВторой абзац\n\nТретий абзац (второй)')
    } finally {
      await other.close()
    }
  })
})

test.describe('документы', () => {
  test('чужой абзац добавлен выше: мой блок остаётся открытым, печатать можно дальше', async ({ page, browser }) => {
    const id = await makeDoc(page, 'Слияние документа', 'page', THREE)
    await openDoc(page, id)
    const second = await blindSecond(browser, { page: 'docs', docOpen: id }, 'Название документа')
    try {
      const current = await docFull(page, id)
      await api(page, `/docs/${id}`, { method: 'PATCH', data: { rev: current.rev, md: `Новый абзац\n\n${THREE}` } })

      await blocks(second.page).nth(2).click()
      await second.page.keyboard.type(' (второй)')
      await expect(notice(second.page)).toBeVisible()
      await expect(editor(second.page)).toBeFocused()
      await second.page.keyboard.type(' ещё')
      await second.page.keyboard.press('Escape')

      await expect.poll(async () => (await docFull(page, id)).md, { timeout: 6000 }).toBe('Новый абзац\n\nПервый абзац\n\nВторой абзац\n\nТретий абзац (второй) ещё')
      await expect(second.page.getByRole('alert')).toHaveCount(0)
    } finally {
      await second.close()
    }
  })

  test('правки в разных абзацах склеиваются и в документе', async ({ page, browser }) => {
    const id = await makeDoc(page, 'Два автора', 'page', THREE)
    await openDoc(page, id)
    const second = await blindSecond(browser, { page: 'docs', docOpen: id }, 'Название документа')
    try {
      await blocks(page).nth(2).click()
      await page.keyboard.type(' (первый)')
      await page.keyboard.press('Escape')
      await expect.poll(async () => (await docFull(page, id)).md, { timeout: 6000 }).toBe('Первый абзац\n\nВторой абзац\n\nТретий абзац (первый)')

      await blocks(second.page).nth(0).click()
      await second.page.keyboard.type(' (второй)')
      await second.page.keyboard.press('Escape')
      await expect.poll(async () => (await docFull(page, id)).md, { timeout: 6000 }).toBe('Первый абзац (второй)\n\nВторой абзац\n\nТретий абзац (первый)')
      await expect(second.page.getByRole('alert')).toHaveCount(0)
    } finally {
      await second.close()
    }
  })
})
