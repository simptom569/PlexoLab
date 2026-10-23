import { expect, test, type Browser, type Page } from '@playwright/test'
import { docFull, makeDoc, openDoc } from './docs-helpers'
import { openApp, resetData } from './fixtures'
import { openSettings, pickTab } from './settings-helpers'
import { api, blocks, editor, makePage, openPageById, wikiPage } from './wiki-helpers'

// Присутствие: полоска и ярлык у блока, в котором сейчас другой человек (lib/realtime/presence.ts, components/PresenceMarks.tsx).
// В макете этого нет, поэтому эталонных снимков нет: проверяем поведение в живых окнах и снимаем свои снимки.
// Люди из сида: Лена М. (основное окно, цвет аватара a), Артём К. (b), Даниил (c).

test.beforeEach(() => resetData())

const THREE = 'Первый абзац\n\nВторой абзац\n\nТретий абзац'

type Kit = {
  name: string
  create: (page: Page, md: string) => Promise<string>
  open: (page: Page, id: string) => Promise<void>
  settings: (id: string) => Record<string, unknown>
  label: string
  patch: (page: Page, id: string, md: string) => Promise<void>
  md: (page: Page, id: string) => Promise<string>
}

const wiki: Kit = {
  name: 'вики',
  create: (page, md) => makePage(page, 'Метки', md),
  open: (page, id) => openPageById(page, id),
  settings: (id) => ({ page: 'wiki', wikiPage: id }),
  label: 'Название страницы',
  patch: async (page, id, md) => {
    const current = await wikiPage(page, id)
    await api(page, `/wiki/${id}`, { method: 'PATCH', data: { rev: current.rev, md } })
  },
  md: async (page, id) => (await wikiPage(page, id)).md,
}

const docs: Kit = {
  name: 'документы',
  create: (page, md) => makeDoc(page, 'Метки', 'page', md),
  open: (page, id) => openDoc(page, id),
  settings: (id) => ({ page: 'docs', docOpen: id }),
  label: 'Название документа',
  patch: async (page, id, md) => {
    const current = await docFull(page, id)
    await api(page, `/docs/${id}`, { method: 'PATCH', data: { rev: current.rev, md } })
  },
  md: async (page, id) => (await docFull(page, id)).md,
}

/** Другой человек (или тот же, в другом окне), у которого эта страница открыта; чужие правки приходят вживую */
async function person(browser: Browser, kit: Kit, id: string, email: string, extra: Record<string, unknown> = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU', timezoneId: 'UTC', reducedMotion: 'reduce' })
  const page = await context.newPage()
  await openApp(page, { email, settings: { ...kit.settings(id), live: true, ...extra } })
  await expect(page.getByLabel(kit.label)).toBeVisible()
  return { page, close: () => context.close() }
}

const ARTEM = 'artem@example.com'
const DANIIL = 'daniil@example.com'
const LENA = 'lena@example.com'

/** Блоки с меткой других людей и их ярлыки */
const marked = (page: Page) => page.locator('.md .mv.pm')
const chips = (page: Page) => page.locator('.md .pm-chip')
const WAIT = { timeout: 6000 }

/** Область снимка: блоки выходят за рамку редактора на 8px (margin:0 -8px у .mv), а полоска стоит у самого края */
async function around(el: ReturnType<Page['locator']>) {
  const box = (await el.boundingBox())!
  return { x: box.x - 14, y: box.y - 14, width: box.width + 28, height: box.height + 28 }
}

for (const kit of [wiki, docs]) {
  test.describe(kit.name, () => {
    test('блок, открытый другим, отмечен полоской и ярлыком с именем; уход из блока снимает метку', async ({ page, browser }) => {
      const id = await kit.create(page, THREE)
      await kit.open(page, id)
      const artem = await person(browser, kit, id, ARTEM)
      try {
        await expect(marked(artem.page)).toHaveCount(0)
        await blocks(page).nth(1).click()
        await expect(editor(page)).toBeFocused()

        await expect(marked(artem.page)).toHaveCount(1, WAIT)
        await expect(blocks(artem.page).nth(1)).toHaveClass(/\bpm\b/)
        await expect(blocks(artem.page).nth(1).locator('.pm-chip')).toContainText('Лена')
        await expect(blocks(artem.page).nth(1).locator('.pm-bar')).toBeVisible()
        await expect(blocks(artem.page).nth(1).locator('.sr')).toHaveText('Лена в этом блоке')
        // цвет блока и ярлыка — цвет аватара человека (у Лены первый), а не что-то выдуманное
        await expect(blocks(artem.page).nth(1)).toHaveClass(/\bpm-a\b/)
        // свою метку человек не видит, и она не мешает ему печатать
        await expect(marked(page)).toHaveCount(0)

        await page.keyboard.press('Escape')
        await expect(marked(artem.page)).toHaveCount(0, WAIT)
      } finally {
        await artem.close()
      }
    })

    test('метка идёт за человеком из блока в блок', async ({ page, browser }) => {
      const id = await kit.create(page, THREE)
      await kit.open(page, id)
      const artem = await person(browser, kit, id, ARTEM)
      try {
        await blocks(page).nth(0).click()
        await expect(blocks(artem.page).nth(0)).toHaveClass(/\bpm\b/, WAIT)
        await page.keyboard.press('ArrowDown') // курсор в конце блока: к следующему
        await expect(blocks(artem.page).nth(1)).toHaveClass(/\bpm\b/, WAIT)
        await expect(marked(artem.page)).toHaveCount(1)
        await expect(blocks(artem.page).nth(0)).not.toHaveClass(/\bpm\b/)
      } finally {
        await artem.close()
      }
    })

    test('чужой абзац добавлен выше: метка остаётся на том же блоке', async ({ page, browser }) => {
      const id = await kit.create(page, THREE)
      await kit.open(page, id)
      const artem = await person(browser, kit, id, ARTEM)
      try {
        await blocks(page).nth(2).click()
        await expect(blocks(artem.page).nth(2)).toHaveClass(/\bpm\b/, WAIT)

        await kit.patch(page, id, `Новый абзац\n\n${THREE}`)
        // у Артёма пришёл новый текст, у Лены он сдвинул открытый блок; метка по-прежнему на «Третьем»
        await expect(blocks(artem.page)).toHaveCount(4, WAIT)
        await expect(marked(artem.page)).toHaveCount(1, WAIT)
        await expect(marked(artem.page)).toContainText('Третий абзац')
        await expect(editor(page)).toBeFocused()
      } finally {
        await artem.close()
      }
    })

    test('пустой блок, вставленный между абзацами, виден как «добавляет блок», а потом как блок с текстом', async ({ page, browser }) => {
      const id = await kit.create(page, THREE)
      await kit.open(page, id)
      const artem = await person(browser, kit, id, ARTEM)
      try {
        await blocks(page).nth(0).click()
        await page.keyboard.press('Enter') // в конце блока: новый пустой блок между первым и вторым
        await expect(editor(page)).toHaveValue('')

        const slot = artem.page.locator('.md .pm-slot')
        await expect(slot).toHaveCount(1, WAIT)
        await expect(slot).toContainText('Лена')
        await expect(slot).toContainText('добавляет блок')
        // заглушка стоит между первым и вторым абзацем
        const order = await artem.page.locator('.md > *').evaluateAll((els) => els.map((e) => (e.classList.contains('pm-slot') ? 'слот' : (e.textContent ?? '').trim().slice(0, 6))))
        expect(order.indexOf('слот')).toBe(1)

        await page.keyboard.type('Вставка')
        await expect(artem.page.locator('.md .pm-slot')).toHaveCount(0, WAIT)
        await expect(marked(artem.page)).toContainText('Вставка')
        await page.keyboard.press('Escape')
        await expect(marked(artem.page)).toHaveCount(0, WAIT)
        expect(await kit.md(page, id)).toBe('Первый абзац\n\nВставка\n\nВторой абзац\n\nТретий абзац')
      } finally {
        await artem.close()
      }
    })

    test('в одном блоке двое: у каждого ярлык «тоже здесь» на рамке открытого поля', async ({ page, browser }) => {
      const id = await kit.create(page, THREE)
      await kit.open(page, id)
      const artem = await person(browser, kit, id, ARTEM)
      try {
        await blocks(page).nth(1).click()
        await expect(blocks(artem.page).nth(1)).toHaveClass(/\bpm\b/, WAIT)
        await blocks(artem.page).nth(1).click()
        await expect(editor(artem.page)).toHaveValue('Второй абзац')

        const mine = (p: Page) => p.locator('.md .pm-mine')
        await expect(mine(artem.page).locator('.pm-chip')).toContainText('Лена тоже здесь', WAIT)
        await expect(mine(page).locator('.pm-chip')).toContainText('Артём тоже здесь', WAIT)
        // поле при этом то же самое: набор не сбивается
        await expect(editor(page)).toBeFocused()
        await page.keyboard.type(' (Лена)')
        await expect(editor(page)).toHaveValue('Второй абзац (Лена)')
      } finally {
        await artem.close()
      }
    })

    test('несколько людей в одном блоке: ярлыки стопкой, у блока цвет последнего пришедшего', async ({ page, browser }) => {
      const id = await kit.create(page, THREE)
      await kit.open(page, id)
      const artem = await person(browser, kit, id, ARTEM)
      const daniil = await person(browser, kit, id, DANIIL)
      try {
        await blocks(artem.page).nth(2).click()
        await expect(blocks(page).nth(2)).toHaveClass(/\bpm\b/, WAIT)
        await blocks(daniil.page).nth(2).click()
        await expect(blocks(page).nth(2).locator('.pm-chip')).toHaveCount(2, WAIT)
        await expect(blocks(page).nth(2)).toHaveClass(/\bpm-c\b/) // Даниил пришёл позже Артёма: цвет третий
        await expect(blocks(page).nth(2).locator('.sr')).toHaveText('Артём, Даниил в этом блоке')
      } finally {
        await daniil.close()
        await artem.close()
      }
    })

    test('«Показывать, где правят другие» выключено: чужих меток нет, а свою человек не сообщает', async ({ page, browser }) => {
      const id = await kit.create(page, THREE)
      await kit.open(page, id)
      const quiet = await person(browser, kit, id, ARTEM, { presence: false })
      const watcher = await person(browser, kit, id, DANIIL)
      try {
        await blocks(page).nth(1).click()
        await expect(blocks(watcher.page).nth(1)).toHaveClass(/\bpm\b/, WAIT) // Даниил Лену видит
        await expect(marked(quiet.page)).toHaveCount(0) // а Артём, у кого выключено, нет
        await blocks(quiet.page).nth(0).click()
        await expect(editor(quiet.page)).toBeFocused()
        await quiet.page.waitForTimeout(1500)
        await expect(blocks(watcher.page).nth(0)).not.toHaveClass(/\bpm\b/) // и Артёма никто не видит
        await expect(marked(page)).toHaveCount(0)
      } finally {
        await watcher.close()
        await quiet.close()
      }
    })

    test('тот же человек в другом окне: у него самого метки нет, у остальных есть', async ({ page, browser }) => {
      const id = await kit.create(page, THREE)
      await kit.open(page, id)
      const other = await person(browser, kit, id, LENA)
      const artem = await person(browser, kit, id, ARTEM)
      try {
        await blocks(other.page).nth(1).click()
        await expect(blocks(artem.page).nth(1)).toHaveClass(/\bpm\b/, WAIT)
        await expect(marked(page)).toHaveCount(0)
      } finally {
        await artem.close()
        await other.close()
      }
    })

    test('человек закрыл окно: его метка у остальных пропадает', async ({ page, browser }) => {
      const id = await kit.create(page, THREE)
      await kit.open(page, id)
      const artem = await person(browser, kit, id, ARTEM)
      await blocks(artem.page).nth(2).click()
      await expect(blocks(page).nth(2)).toHaveClass(/\bpm\b/, WAIT)
      await artem.close()
      await expect(marked(page)).toHaveCount(0, WAIT)
    })

    test('опоздавший видит тех, кто уже в блоках', async ({ page, browser }) => {
      const id = await kit.create(page, THREE)
      await kit.open(page, id)
      const artem = await person(browser, kit, id, ARTEM)
      try {
        await blocks(artem.page).nth(0).click()
        await expect(blocks(page).nth(0)).toHaveClass(/\bpm\b/, WAIT)
        const late = await person(browser, kit, id, DANIIL)
        try {
          await expect(blocks(late.page).nth(0)).toHaveClass(/\bpm\b/, WAIT)
          await expect(blocks(late.page).nth(0).locator('.pm-chip')).toContainText('Артём')
        } finally {
          await late.close()
        }
      } finally {
        await artem.close()
      }
    })
  })
}

test('выключили тумблер в настройках на лету: метка человека пропадает у остальных, а чужих он больше не видит', async ({ page, browser }) => {
  const id = await wiki.create(page, THREE)
  await wiki.open(page, id)
  const artem = await person(browser, wiki, id, ARTEM)
  try {
    await blocks(artem.page).nth(2).click()
    await expect(blocks(page).nth(2)).toHaveClass(/\bpm\b/, WAIT)
    await blocks(page).nth(0).click()
    await expect(blocks(artem.page).nth(0)).toHaveClass(/\bpm\b/, WAIT)

    // окно настроек (помощник открывает его под Леной): выключаем тумблер
    const dialog = await openSettings(page)
    await pickTab(dialog, 'Связь с сервером')
    await dialog.getByRole('switch', { name: 'Показывать, где правят другие' }).click()
    await page.keyboard.press('Escape')

    await expect(marked(page)).toHaveCount(0) // чужих меток она больше не видит
    await expect(marked(artem.page)).toHaveCount(0, WAIT) // и её метка у Артёма пропала

    // включили обратно: метки возвращаются
    const again = await openSettings(page)
    await pickTab(again, 'Связь с сервером')
    await again.getByRole('switch', { name: 'Показывать, где правят другие' }).click()
    await page.keyboard.press('Escape')
    await expect(marked(page)).toHaveCount(1, WAIT)
  } finally {
    await artem.close()
  }
})

// Снимки меток в обеих темах: Лена и Даниил в блоках, Артём смотрит. Имена сворачиваются в кружки через 3 секунды,
// а у заглушки пустого блока имя остаётся, поэтому снимаем после сворачивания.
for (const theme of ['light', 'dark'] as const) {
  test(`снимок меток (${theme})`, async ({ page, browser }) => {
    const id = await wiki.create(page, THREE)
    await openApp(page, { email: ARTEM, theme, settings: { ...wiki.settings(id), live: true } })
    await expect(page.getByLabel(wiki.label)).toBeVisible()
    const lena = await person(browser, wiki, id, LENA)
    const daniil = await person(browser, wiki, id, DANIIL)
    try {
      await blocks(lena.page).nth(1).click()
      await blocks(daniil.page).nth(2).click()
      await expect(marked(page)).toHaveCount(2, WAIT)
      await expect(page.locator('.md .pm-chip.fold')).toHaveCount(2, WAIT)
      await expect(page).toHaveScreenshot(`presence-blocks-${theme}.png`, { clip: await around(page.locator('.md')) })
    } finally {
      await daniil.close()
      await lena.close()
    }
  })

  test(`снимок заглушки пустого блока и поля с ярлыком «тоже здесь» (${theme})`, async ({ page, browser }) => {
    const id = await wiki.create(page, THREE)
    await openApp(page, { theme, settings: { ...wiki.settings(id), live: true } })
    await expect(page.getByLabel(wiki.label)).toBeVisible()
    const artem = await person(browser, wiki, id, ARTEM)
    try {
      await blocks(artem.page).nth(0).click()
      await artem.page.keyboard.press('Enter')
      await expect(page.locator('.md .pm-slot')).toHaveCount(1, WAIT)
      await blocks(page).nth(2).click()
      await blocks(artem.page).nth(2).click() // Артём перешёл в третий блок, пустой блок он покинул
      await expect(chips(page)).toHaveCount(1, WAIT)
      await expect(page.locator('.md .pm-slot')).toHaveCount(0, WAIT)
      await expect(page.locator('.md .pm-mine .pm-chip')).toContainText('Артём тоже здесь', WAIT)
      await expect(page).toHaveScreenshot(`presence-mine-${theme}.png`, { clip: await around(page.locator('.md')) })
    } finally {
      await artem.close()
    }
  })
}
