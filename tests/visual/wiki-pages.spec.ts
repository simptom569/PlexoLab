// Дерево страниц, создание и удаление, сохранение с задержкой, конфликт версий двух клиентов.

import { expect, test } from '@playwright/test'
import { openApp, resetData } from './fixtures'
import {
  blocks,
  editor,
  expectSaved,
  idOf,
  library,
  makePage,
  openPageById,
  openWiki,
  wikiNodes,
  wikiPage,
  api,
} from './wiki-helpers'

test.beforeEach(() => resetData())

const tree = (page: import('@playwright/test').Page) => page.getByRole('tree', { name: 'Дерево страниц' })
const title = (page: import('@playwright/test').Page) => page.getByLabel('Название страницы')
const removeButton = (page: import('@playwright/test').Page) =>
  page.locator('.doc-main .head').getByRole('button', { name: /^(Удалить|Точно удалить\?)$/ })

test.describe('дерево страниц', () => {
  test('страницы идут деревом, ветки сворачиваются и разворачиваются', async ({ page }) => {
    await openWiki(page, 'Начало работы')
    await expect(tree(page).getByRole('treeitem')).toHaveText(['Начало работы', 'Разработка', 'Процессы'])
    await tree(page).getByRole('button', { name: 'Развернуть или свернуть' }).first().click()
    await expect(tree(page).getByRole('treeitem')).toHaveText(['Начало работы', 'Разработка', 'Соглашения по коду', 'Деплой и окружения', 'Процессы'])
    await tree(page).getByRole('button', { name: 'Развернуть или свернуть' }).first().click()
    await expect(tree(page).getByRole('treeitem')).toHaveCount(3)
  })

  test('открытая страница выделена, дерево раскрыто до неё, крошки ведут по пути', async ({ page }) => {
    await openWiki(page, 'Соглашения по коду')
    await expect(tree(page).locator('.tr.on')).toHaveText('Соглашения по коду')
    await expect(page.locator('.doc-main .crumb .crumb-btn')).toHaveText(['Разработка', 'Соглашения по коду'])
    await page.locator('.doc-main .crumb .crumb-btn').first().click()
    await expect(title(page)).toHaveValue('Разработка')
  })

  test('поиск показывает плоский список подходящих страниц и «Ничего не найдено»', async ({ page }) => {
    await openWiki(page, 'Начало работы')
    const search = page.getByPlaceholder('Поиск страниц')
    await search.fill('деплой')
    await expect(tree(page).getByRole('treeitem')).toHaveText(['Деплой и окружения'])
    await search.fill('такого нет')
    await expect(tree(page)).toContainText('Ничего не найдено')
    await search.fill('')
    await expect(tree(page).getByRole('treeitem')).toHaveCount(3)
  })

  test('«Новая страница» создаёт страницу в корне и открывает её на первом блоке', async ({ page }) => {
    await openWiki(page, 'Начало работы')
    await page.getByRole('button', { name: 'Новая страница' }).click()
    await expect(title(page)).toHaveValue('')
    await expect(title(page)).toHaveAttribute('placeholder', 'Без названия')
    await expect(editor(page)).toBeFocused()
    await expect(tree(page).getByRole('treeitem')).toHaveCount(4)
    await expect(tree(page).getByRole('treeitem').last()).toHaveText('Без названия')
    await expect(tree(page).locator('.tr.on')).toHaveText('Без названия')

    await page.keyboard.type('Первая строка')
    await page.keyboard.press('Escape')
    const nodes = await wikiNodes(page)
    const created = nodes.find((n) => n.title === '' && n.parent_id === null)!
    await expectSaved(page, created.id, 'Первая строка')
  })

  test('«+» у страницы создаёт вложенную и раскрывает родителя', async ({ page }) => {
    await openWiki(page, 'Начало работы')
    await page.getByRole('button', { name: 'Добавить вложенную страницу в Процессы' }).click()
    await expect(editor(page)).toBeFocused()
    await expect(page.locator('.doc-main .crumb .crumb-btn')).toHaveText(['Процессы', 'Без названия'])
    await expect(tree(page).getByRole('treeitem')).toHaveText(['Начало работы', 'Разработка', 'Процессы', 'Работа с задачами', 'Онбординг', 'Без названия'])
    const processes = await idOf(page, 'Процессы')
    expect((await wikiNodes(page)).filter((n) => n.parent_id === processes)).toHaveLength(3)
  })

  test('двойное нажатие «Новая страница» не создаёт две страницы', async ({ page }) => {
    await openWiki(page, 'Начало работы')
    await page.getByRole('button', { name: 'Новая страница' }).dblclick()
    await expect(editor(page)).toBeFocused()
    await page.waitForTimeout(500)
    expect((await wikiNodes(page)).filter((n) => n.title === '')).toHaveLength(1)
  })

  test('название правится на месте: дерево и крошки обновляются сразу, сервер получает после паузы', async ({ page }) => {
    const parent = await idOf(page, 'Разработка')
    const id = await makePage(page, 'Старое', 'Текст', parent)
    await openPageById(page, id)
    await title(page).fill('Новое название')
    await expect(tree(page).getByRole('treeitem', { name: 'Новое название' })).toBeVisible()
    await expect(page.locator('.doc-main .crumb .crumb-btn').last()).toHaveText('Новое название')
    await expect.poll(async () => (await wikiPage(page, id)).title).toBe('Новое название')
  })

  test('удаление в два шага убирает страницу с вложенными, файлы остаются без страницы', async ({ page }) => {
    await openWiki(page, 'Разработка')
    const before = await library(page)
    const attached = before.files.filter((f) => f.wiki_page_id !== null)
    expect(attached.length).toBeGreaterThan(0)

    await removeButton(page).click()
    await expect(removeButton(page)).toHaveText('Точно удалить?')
    await removeButton(page).click()

    await expect(tree(page).getByRole('treeitem')).toHaveText(['Начало работы', 'Процессы'])
    await expect(title(page)).toHaveValue('Начало работы')
    const nodes = await wikiNodes(page)
    expect(nodes.map((n) => n.title).sort()).toEqual(['Начало работы', 'Онбординг', 'Процессы', 'Работа с задачами'])
    const after = await library(page)
    expect(after.total).toBe(before.total)
    expect(after.files.every((f) => f.wiki_page_id === null || nodes.some((n) => n.id === f.wiki_page_id))).toBe(true)
    expect(after.files.filter((f) => attached.some((a) => a.id === f.id)).every((f) => f.wiki_page_id === null)).toBe(true)
  })

  test('первое нажатие «Удалить» относится только к своей странице', async ({ page }) => {
    await openWiki(page, 'Начало работы')
    await removeButton(page).click()
    await expect(removeButton(page)).toHaveText('Точно удалить?')
    await page.getByRole('treeitem', { name: 'Процессы' }).click()
    await expect(title(page)).toHaveValue('Процессы')
    await expect(removeButton(page)).toHaveText('Удалить')
    expect((await wikiNodes(page)).map((n) => n.title)).toContain('Начало работы')
  })

  test('когда страниц нет, предлагается создать первую', async ({ page }) => {
    for (const n of (await wikiNodes(page)).filter((x) => x.parent_id === null)) await api(page, `/wiki/${n.id}`, { method: 'DELETE' })
    await openApp(page, { settings: { page: 'wiki' } })
    await expect(page.locator('.doc-main')).toContainText('Страниц нет. Создай первую кнопкой слева')
    await page.getByRole('button', { name: 'Новая страница' }).click()
    await expect(editor(page)).toBeFocused()
  })
})

test.describe('сохранение страницы', () => {
  test('правка уходит на сервер после паузы; выход из правки сохраняет сразу', async ({ page }) => {
    const id = await makePage(page, 'Пауза', 'Было')
    await openPageById(page, id)
    await blocks(page).first().click()
    await page.keyboard.type(' стало')
    expect((await wikiPage(page, id)).md).toBe('Было')
    await expectSaved(page, id, 'Было стало')
    expect((await wikiPage(page, id)).rev).toBe(2)

    await page.keyboard.type('!')
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await wikiPage(page, id)).md, { timeout: 450 }).toBe('Было стало!')
  })

  test('ушли со страницы, не дождавшись паузы: правка всё равно сохраняется', async ({ page }) => {
    const id = await makePage(page, 'Побег', 'Текст')
    await openPageById(page, id)
    await blocks(page).first().click()
    await page.keyboard.type(' дописано')
    await page.getByRole('treeitem', { name: 'Начало работы' }).click()
    await expect(title(page)).toHaveValue('Начало работы')
    await expectSaved(page, id, 'Текст дописано')
  })

  test('вернулись на страницу сразу после ухода: виден свой текст, а не старый', async ({ page }) => {
    const id = await makePage(page, 'Туда-сюда', 'Текст')
    await openPageById(page, id)
    await blocks(page).first().click()
    await page.keyboard.type(' плюс')
    await page.getByRole('treeitem', { name: 'Начало работы' }).click()
    await page.getByRole('treeitem', { name: 'Туда-сюда' }).click()
    await expect(blocks(page).first()).toHaveText('Текст плюс')
  })

  test('последняя открытая страница запоминается', async ({ page }) => {
    await openWiki(page, 'Начало работы')
    await page.getByRole('treeitem', { name: 'Процессы' }).click()
    await expect(title(page)).toHaveValue('Процессы')
    await page.waitForTimeout(600)
    await page.reload()
    await expect(title(page)).toHaveValue('Процессы')
  })

  test('сервер отказал: плашка об ошибке, текст остаётся, потом сохраняется сам', async ({ page }) => {
    const id = await makePage(page, 'Сбой', 'Текст')
    await openPageById(page, id)
    let failures = 1
    await page.route(`**/api/v1/wiki/${id}`, (route) => {
      if (route.request().method() === 'PATCH' && failures-- > 0) return route.fulfill({ status: 500, json: { code: 'internal', message: 'Внутренняя ошибка сервера' } })
      return route.continue()
    })
    await blocks(page).first().click()
    await page.keyboard.type(' ещё')
    await expect(page.getByText('Не удалось сохранить страницу, попробуем ещё раз')).toBeVisible()
    await expect(editor(page)).toHaveValue('Текст ещё')
    await expectSaved(page, id, 'Текст ещё') // повтор через 5 секунд
  })
})

test.describe('конфликт версий', () => {
  test('чужая правка даёт баннер, «Загрузить его версию» берёт чужой текст', async ({ page, browser }) => {
    const id = await makePage(page, 'Общая', 'Исходный')
    await openPageById(page, id)

    const other = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' })
    const second = await other.newPage()
    try {
      await openPageById(second, id)

      // первый дописывает и сохраняет
      await blocks(page).first().click()
      await page.keyboard.type(' (первый)')
      await page.keyboard.press('Escape')
      await expectSaved(page, id, 'Исходный (первый)')

      // второй правил ту же версию, которую уже никто не помнит
      await blocks(second).first().click()
      await second.keyboard.type(' (второй)')
      await second.keyboard.press('Escape')
      const banner = second.getByRole('alert')
      await expect(banner).toContainText('Страницу изменил другой участник')
      expect((await wikiPage(page, id)).md).toBe('Исходный (первый)')

      await banner.getByRole('button', { name: 'Загрузить его версию' }).click()
      await expect(banner).toHaveCount(0)
      await expect(blocks(second).first()).toHaveText('Исходный (первый)')

      // дальше второй сохраняется как обычно
      await blocks(second).first().click()
      await second.keyboard.type('!')
      await second.keyboard.press('Escape')
      await expectSaved(second, id, 'Исходный (первый)!')
    } finally {
      await other.close()
    }
  })

  test('«Оставить мою» записывает свой текст поверх чужого', async ({ page, browser }) => {
    const id = await makePage(page, 'Спор', 'Исходный')
    await openPageById(page, id)

    const other = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' })
    const second = await other.newPage()
    try {
      await openPageById(second, id)
      await blocks(page).first().click()
      await page.keyboard.type(' (первый)')
      await page.keyboard.press('Escape')
      await expectSaved(page, id, 'Исходный (первый)')

      await blocks(second).first().click()
      await second.keyboard.type(' (второй)')
      await second.keyboard.press('Escape')
      const banner = second.getByRole('alert')
      await expect(banner).toBeVisible()
      await banner.getByRole('button', { name: 'Оставить мою' }).click()
      await expect(banner).toHaveCount(0)
      await expectSaved(page, id, 'Исходный (второй)')
      expect((await wikiPage(page, id)).rev).toBe(3)
    } finally {
      await other.close()
    }
  })

  test('пока баннер открыт, правки не уходят на сервер', async ({ page, browser }) => {
    const id = await makePage(page, 'Тишина', 'Исходный')
    await openPageById(page, id)
    const other = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' })
    const second = await other.newPage()
    try {
      await openPageById(second, id)
      await api(page, `/wiki/${id}`, { method: 'PATCH', data: { rev: 1, md: 'Чужая правка' } })

      await blocks(second).first().click()
      await second.keyboard.type(' моя')
      await expect(second.getByRole('alert')).toBeVisible({ timeout: 8000 })
      await second.keyboard.type(' ещё')
      await second.waitForTimeout(1500)
      expect((await wikiPage(page, id)).md).toBe('Чужая правка')
      await expect(editor(second)).toHaveValue('Исходный моя ещё')
    } finally {
      await other.close()
    }
  })
})
