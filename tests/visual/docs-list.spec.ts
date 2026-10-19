// Список документов и документ как целое: создание, звёздочка, поиск, «Избранные», удаление, возврат к открытому документу.
// Внешний вид сверяется с эталоном в docs.spec.ts, здесь поведение.

import { expect, test, type Page } from '@playwright/test'
import { api } from './wiki-helpers'
import { cardTitles, cards, docFull, docId, docSummaries, makeDoc, openDocs, openDocByTitle, orderOnServer } from './docs-helpers'
import { resetData } from './fixtures'

test.beforeEach(() => resetData())

/** Пункт бокового меню */
const nav = (page: Page, name: string | RegExp) => page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name })

const ALL = ['Схема сервисов', 'Планирование Q4', 'Идеи по онбордингу', 'Заметки со встречи 15 окт']

test.describe('создание', () => {
  test('«Новый документ» создаёт страницу первой в списке и открывает её с курсором в первом блоке', async ({ page }) => {
    await openDocs(page)
    await page.getByRole('button', { name: 'Новый документ' }).click()

    await expect(page.getByLabel('Название документа')).toBeVisible()
    await expect(page.locator('.cv.page')).toBeVisible()
    await expect(page.locator('textarea.md-ta')).toBeFocused()
    await expect(page.getByRole('group', { name: 'Режим документа' }).getByRole('button', { name: 'Страница', exact: true })).toHaveAttribute('aria-pressed', 'true')

    await expect.poll(async () => (await docSummaries(page)).length).toBe(5)
    const created = (await docSummaries(page))[0]!
    expect(created.title).toBe('')
    expect(created.mode).toBe('page')

    await page.getByRole('button', { name: 'Все документы' }).click()
    await expect(cards(page)).toHaveCount(5)
    await expect(cards(page).first().locator('.dcard-title')).toHaveText('Без названия')
    await expect(cards(page).first().locator('.dcard-snip')).toHaveText('Пустой документ')
    await expect(cards(page).first().locator('.dmeta')).toContainText('Страница')
    await expect(cards(page).first().locator('.dmeta')).toContainText('Без холста')
  })

  test('«Новый холст» открывает документ в режиме холста с панелью инструментов', async ({ page }) => {
    await openDocs(page)
    await page.getByRole('button', { name: 'Новый холст' }).click()
    await expect(page.locator('.cv.edge')).toBeVisible()
    await expect(page.getByRole('toolbar', { name: 'Инструменты холста' })).toBeVisible()
    await expect(page.locator('.note.edge')).toHaveCSS('left', '40px')
    await expect(page.locator('.note.edge')).toHaveCSS('top', '36px')
    await expect.poll(async () => (await docSummaries(page))[0]!.mode).toBe('edge')
  })

  test('двойное нажатие на «Новый документ» создаёт один документ', async ({ page }) => {
    await openDocs(page)
    await page.getByRole('button', { name: 'Новый документ' }).dblclick()
    await expect(page.getByLabel('Название документа')).toBeVisible()
    await page.waitForTimeout(500)
    expect(await docSummaries(page)).toHaveLength(5)
  })
})

test.describe('звёздочка и «Избранные»', () => {
  test('звёздочка на карточке ставится и снимается, сервер знает', async ({ page }) => {
    await openDocs(page)
    const card = cards(page).filter({ hasText: 'Планирование Q4' })
    const star = card.getByRole('button', { name: 'В избранное' })
    await star.click()
    await expect(card.getByRole('button', { name: 'Убрать из избранного' })).toHaveClass(/\bon\b/)
    await expect.poll(async () => (await docSummaries(page)).filter((d) => d.starred).map((d) => d.title).sort()).toEqual(['Планирование Q4', 'Схема сервисов'])

    await card.getByRole('button', { name: 'Убрать из избранного' }).click()
    await expect(card.getByRole('button', { name: 'В избранное' })).not.toHaveClass(/\bon\b/)
    await expect.poll(async () => (await docSummaries(page)).filter((d) => d.starred).map((d) => d.title)).toEqual(['Схема сервисов'])
  })

  test('звёздочка не открывает документ', async ({ page }) => {
    await openDocs(page)
    await cards(page).filter({ hasText: 'Идеи по онбордингу' }).getByRole('button', { name: 'В избранное' }).click()
    await expect(cards(page)).toHaveCount(4)
    await expect(page.getByLabel('Название документа')).toHaveCount(0)
  })

  test('«Избранные» оставляет документы со звёздочкой, фильтр помнится после перезапуска', async ({ page }) => {
    await openDocs(page)
    const chip = page.getByRole('button', { name: 'Избранные' })
    await expect(chip).toHaveAttribute('aria-pressed', 'false')
    await chip.click()
    await expect(chip).toHaveAttribute('aria-pressed', 'true')
    await expect(cardTitles(page)).toHaveText(['Схема сервисов'])

    await page.reload()
    await expect(page.getByRole('button', { name: 'Избранные' })).toHaveAttribute('aria-pressed', 'true')
    await expect(cardTitles(page)).toHaveText(['Схема сервисов'])

    await page.getByRole('button', { name: 'Избранные' }).click()
    await expect(cardTitles(page)).toHaveText(ALL)
  })

  test('в «Избранных» пусто — «Документов не найдено»; звёздочка в самом документе работает так же', async ({ page }) => {
    const id = await docId(page, 'Схема сервисов')
    await api(page, `/docs/${id}/star`, { method: 'PUT', data: { starred: false } })
    await openDocs(page)
    await page.getByRole('button', { name: 'Избранные' }).click()
    await expect(page.getByText('Документов не найдено')).toBeVisible()

    await page.getByRole('button', { name: 'Избранные' }).click()
    await cards(page).filter({ hasText: 'Планирование Q4' }).locator('.dcard-open').click()
    const star = page.locator('.dstar-inline')
    await expect(star).not.toHaveClass(/\bon\b/)
    await star.click()
    await expect(star).toHaveClass(/\bon\b/)
    await expect(star).toHaveAccessibleName('Убрать из избранного')
    await expect.poll(async () => (await docFull(page, await docId(page, 'Планирование Q4'))).starred).toBe(true)
  })
})

test.describe('поиск', () => {
  test('ищет по названию и по тексту без учёта регистра', async ({ page }) => {
    await openDocs(page)
    const search = page.getByRole('searchbox', { name: 'Поиск по документам' })

    await search.fill('СХЕМА')
    await expect(cardTitles(page)).toHaveText(['Схема сервисов'])

    await search.fill('релиз') // есть только в тексте
    await expect(cardTitles(page)).toHaveText(['Планирование Q4', 'Заметки со встречи 15 окт'])

    await search.fill('такого нет нигде')
    await expect(page.getByText('Документов не найдено')).toBeVisible()
    await expect(cards(page)).toHaveCount(0)

    await search.fill('')
    await expect(cardTitles(page)).toHaveText(ALL)
  })

  test('поиск работает вместе с «Избранными»', async ({ page }) => {
    await openDocs(page)
    await page.getByRole('button', { name: 'Избранные' }).click()
    await page.getByRole('searchbox', { name: 'Поиск по документам' }).fill('схема')
    await expect(cardTitles(page)).toHaveText(['Схема сервисов'])
    await page.getByRole('searchbox', { name: 'Поиск по документам' }).fill('релиз')
    await expect(page.getByText('Документов не найдено')).toBeVisible()
  })

  test('новый документ сбрасывает поиск', async ({ page }) => {
    await openDocs(page)
    await page.getByRole('searchbox', { name: 'Поиск по документам' }).fill('схема')
    await expect(cards(page)).toHaveCount(1)
    await page.getByRole('button', { name: 'Новый документ' }).click()
    await page.getByRole('button', { name: 'Все документы' }).click()
    await expect(page.getByRole('searchbox', { name: 'Поиск по документам' })).toHaveValue('')
    await expect(cards(page)).toHaveCount(5)
  })
})

test.describe('открытый документ', () => {
  test('карточка открывает документ, «Все документы» возвращает к списку', async ({ page }) => {
    await openDocs(page)
    await cards(page).filter({ hasText: 'Планирование Q4' }).locator('.dcard-open').click()
    await expect(page.getByLabel('Название документа')).toHaveValue('Планирование Q4')
    await expect(page.locator('.md .mv').first()).toBeVisible()
    await page.getByRole('button', { name: 'Все документы' }).click()
    await expect(cards(page)).toHaveCount(4)
  })

  test('после перезапуска открывается тот же документ', async ({ page }) => {
    await openDocByTitle(page, 'Планирование Q4')
    await page.reload()
    await expect(page.getByLabel('Название документа')).toHaveValue('Планирование Q4')
    await page.getByRole('button', { name: 'Все документы' }).click()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Документы', level: 1 })).toBeVisible()
  })

  test('сохранённый документ удалили: открывается список', async ({ page }) => {
    await openDocs(page, 'light', { docOpen: '00000000-0000-4000-8000-000000000000' })
    await expect(cards(page)).toHaveCount(4)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Документы', level: 1 })).toBeVisible()
  })

  test('«Удалить» в два шага, документ исчезает из списка и с сервера', async ({ page }) => {
    await openDocByTitle(page, 'Идеи по онбордингу')
    const remove = page.getByRole('button', { name: 'Удалить', exact: true })
    await remove.click()
    await expect(page.getByRole('button', { name: 'Точно удалить?' })).toBeVisible()
    expect(await orderOnServer(page)).toHaveLength(4)
    await page.getByRole('button', { name: 'Точно удалить?' }).click()

    await expect(page.getByRole('heading', { name: 'Документы', level: 1 })).toBeVisible()
    await expect(cardTitles(page)).toHaveText(['Схема сервисов', 'Планирование Q4', 'Заметки со встречи 15 окт'])
    await expect.poll(() => orderOnServer(page)).toEqual(['Схема сервисов', 'Планирование Q4', 'Заметки со встречи 15 окт'])
  })

  test('смена страницы сбрасывает подтверждение удаления', async ({ page }) => {
    await openDocByTitle(page, 'Идеи по онбордингу')
    await page.getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Точно удалить?' })).toBeVisible()
    await nav(page, /^Бэклог/).click()
    await nav(page, 'Документы').click()
    await expect(page.getByRole('button', { name: 'Удалить', exact: true })).toBeVisible()
  })
})

test('документ другого человека открывается и имеет автора на карточке', async ({ page }) => {
  await makeDoc(page, 'Чужой документ', 'page', 'Текст')
  await openDocs(page)
  await expect(cards(page).first().locator('.avatar')).toHaveAccessibleName('Лена М.')
  await expect(cards(page).filter({ hasText: 'Схема сервисов' }).locator('.avatar')).toHaveAccessibleName('Даниил С.')
})

test('в боковом меню «Документы» возвращает к открытому документу', async ({ page }) => {
  await openDocByTitle(page, 'Планирование Q4')
  await nav(page, /^Доска/).click()
  await nav(page, 'Документы').click()
  // документ остаётся открытым, как в макете (go не сбрасывает docId)
  await expect(page.getByLabel('Название документа')).toHaveValue('Планирование Q4')
})
