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
/** Прежнее всплывающее сообщение о слиянии: его больше нет, слияние тихое */
const toast = (page: Page) => page.getByText(/Объединено с/)

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
  test('правки в разных абзацах склеиваются тихо: ни баннера, ни сообщения, обе правки на месте', async ({ page, browser }) => {
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
      await expect(toast(second.page)).toHaveCount(0)
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
      // слияние прошло: чужой абзац появился выше (мой блок открыт, поэтому отрисованных блоков три, а не четыре)
      await expect(blocks(second.page)).toHaveText(['Новый абзац', 'Первый абзац', 'Второй абзац'])

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

  test('оба добавили новый блок в одно место: остаются оба, чужой выше, баннера нет', async ({ page, browser }) => {
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
      await expectSaved(page, id, `${THREE}\n\nПервый новый\n\nВторой новый`)
      await expect(second.page.getByRole('alert')).toHaveCount(0)
      await expect(toast(second.page)).toHaveCount(0)
      await expect(blocks(second.page)).toHaveText(['Первый абзац', 'Второй абзац', 'Третий абзац', 'Первый новый', 'Второй новый'])
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

// Пустой блок, который человек только что вставил между абзацами (Enter в конце блока), лежит в общем тексте как три пустые
// строки. Выход соседа из своего блока раньше чистил весь текст и стирал их: у владельца пустого блока редактор закрывался,
// и всё, что он печатал дальше, уходило в пустоту. Теперь очистка идёт только вокруг блока, из которого вышли.
test.describe('пустой блок между абзацами переживает выход соседа из своего блока', () => {
  const WITH_EMPTY = 'Первый абзац (Лена)\n\n\n\nВторой абзац\n\nТретий абзац'
  const AFTER = 'Первый абзац (Лена)\n\nВставка\n\nВторой абзац\n\nТретий абзац'

  /** Лена дописывает первый абзац и жмёт Enter в его конце: между первым и вторым появляется её пустой блок */
  async function openEmptyBlock(page: Page) {
    await blocks(page).nth(0).click()
    await page.keyboard.type(' (Лена)')
    await page.keyboard.press('Enter')
    await expect(editor(page)).toBeFocused()
    await expect(editor(page)).toHaveValue('')
  }

  test('вики', async ({ page, browser }) => {
    const id = await makePage(page, 'Пустой блок', THREE)
    await openPageById(page, id)
    const other = await liveSecond(browser, { page: 'wiki', wikiPage: id }, 'Название страницы')
    try {
      await openEmptyBlock(page)
      await expectSaved(page, id, WITH_EMPTY)
      // у Артёма чужая версия уже на экране: значит, он знает и про пустые строки
      await expect(blocks(other.page)).toHaveText(['Первый абзац (Лена)', 'Второй абзац', 'Третий абзац'])

      await blocks(other.page).nth(2).click()
      await expect(editor(other.page)).toHaveValue('Третий абзац')
      await other.page.keyboard.press('Escape')
      await expect(editor(other.page)).toHaveCount(0)

      // у Артёма нечего чистить, и сохранять тоже нечего: текст на сервере прежний, а у Лены блок открыт и курсор в нём
      await other.page.waitForTimeout(1500)
      expect((await wikiPage(page, id)).md).toBe(WITH_EMPTY)
      await expect(editor(page)).toBeFocused()
      await expect(editor(page)).toHaveValue('')

      await page.keyboard.type('Вставка')
      await page.keyboard.press('Escape')
      await expectSaved(page, id, AFTER)
    } finally {
      await other.close()
    }
  })

  test('документ', async ({ page, browser }) => {
    const id = await makeDoc(page, 'Пустой блок', 'page', THREE)
    await openDoc(page, id)
    const other = await liveSecond(browser, { page: 'docs', docOpen: id }, 'Название документа')
    try {
      await openEmptyBlock(page)
      await expect.poll(async () => (await docFull(page, id)).md, { timeout: 6000 }).toBe(WITH_EMPTY)
      await expect(blocks(other.page)).toHaveText(['Первый абзац (Лена)', 'Второй абзац', 'Третий абзац'])

      await blocks(other.page).nth(2).click()
      await expect(editor(other.page)).toHaveValue('Третий абзац')
      await other.page.keyboard.press('Escape')
      await expect(editor(other.page)).toHaveCount(0)

      await other.page.waitForTimeout(1500)
      expect((await docFull(page, id)).md).toBe(WITH_EMPTY)
      await expect(editor(page)).toBeFocused()
      await expect(editor(page)).toHaveValue('')

      await page.keyboard.type('Вставка')
      await page.keyboard.press('Escape')
      await expect.poll(async () => (await docFull(page, id)).md, { timeout: 6000 }).toBe(AFTER)
    } finally {
      await other.close()
    }
  })
})

test.describe('документы', () => {
  test('двое одновременно пишут в новой строке: остаются оба текста, баннера нет, фокус у обоих на месте', async ({ page, browser }) => {
    const id = await makeDoc(page, 'Две новые строки', 'page', THREE)
    await openDoc(page, id)
    const other = await liveSecond(browser, { page: 'docs', docOpen: id }, 'Название документа')
    try {
      await page.locator('.md-add').click()
      await other.page.locator('.md-add').click()
      await page.keyboard.type('Новый от Лены')
      await other.page.keyboard.type('Новый от Артёма')
      await expect.poll(async () => (await docFull(page, id)).md, { timeout: 6000 }).toBe(`${THREE}\n\nНовый от Лены\n\nНовый от Артёма`)

      for (const who of [page, other.page]) {
        await expect(who.getByRole('alert')).toHaveCount(0)
        await expect(editor(who)).toBeFocused()
      }
      await expect(editor(page)).toHaveValue('Новый от Лены')
      await expect(editor(other.page)).toHaveValue('Новый от Артёма')

      // оба продолжают печатать там, где стояли
      await page.keyboard.type(' и ещё')
      await other.page.keyboard.type(' и ещё')
      await expect
        .poll(async () => (await docFull(page, id)).md, { timeout: 6000 })
        .toBe(`${THREE}\n\nНовый от Лены и ещё\n\nНовый от Артёма и ещё`)
      await expect(page.getByRole('alert')).toHaveCount(0)
      await expect(other.page.getByRole('alert')).toHaveCount(0)
    } finally {
      await other.close()
    }
  })

  test('чужой абзац добавлен выше: мой блок остаётся открытым, печатать можно дальше', async ({ page, browser }) => {
    const id = await makeDoc(page, 'Слияние документа', 'page', THREE)
    await openDoc(page, id)
    const second = await blindSecond(browser, { page: 'docs', docOpen: id }, 'Название документа')
    try {
      const current = await docFull(page, id)
      await api(page, `/docs/${id}`, { method: 'PATCH', data: { rev: current.rev, md: `Новый абзац\n\n${THREE}` } })

      await blocks(second.page).nth(2).click()
      await second.page.keyboard.type(' (второй)')
      // слияние прошло: чужой абзац появился выше (мой блок открыт, поэтому отрисованных блоков три, а не четыре)
      await expect(blocks(second.page)).toHaveText(['Новый абзац', 'Первый абзац', 'Второй абзац'])
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
