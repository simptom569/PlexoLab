// Документ: название и текст сохраняются, режим «Страница / Холст» ничего не теряет, конфликт версий.

import { expect, test, type Page } from '@playwright/test'
import { blocks, editor, api } from './wiki-helpers'
import { cards, docFull, items, makeDoc, openDoc, openDocByTitle } from './docs-helpers'
import { resetData } from './fixtures'

test.beforeEach(() => resetData())

const modeButton = (page: Page, name: 'Страница' | 'Холст') =>
  page.getByRole('group', { name: 'Режим документа' }).getByRole('button', { name, exact: true })

test.describe('название и текст', () => {
  test('название сохраняется на сервере и видно в списке', async ({ page }) => {
    const id = await openDocByTitle(page, 'Идеи по онбордингу')
    const title = page.getByLabel('Название документа')
    await title.fill('Идеи по онбордингу, версия 2')
    await expect.poll(async () => (await docFull(page, id)).title).toBe('Идеи по онбордингу, версия 2')
    expect((await docFull(page, id)).rev).toBe(2)

    await page.getByRole('button', { name: 'Все документы' }).click()
    await expect(cards(page).filter({ hasText: 'версия 2' })).toHaveCount(1)
  })

  test('текст сохраняется на сервере через паузу, версия растёт', async ({ page }) => {
    const id = await openDocByTitle(page, 'Идеи по онбордингу')
    await blocks(page).first().click()
    await editor(page).press('Control+End')
    await page.keyboard.type(' Дописали.')
    await expect.poll(async () => (await docFull(page, id)).md, { timeout: 6000 }).toContain('Дописали.')
    expect((await docFull(page, id)).rev).toBeGreaterThan(1)

    // после перезапуска текст на месте
    await page.reload()
    await expect(page.getByLabel('Название документа')).toHaveValue('Идеи по онбордингу')
    await expect(page.locator('.md')).toContainText('Дописали.')
  })

  test('новый документ: можно сразу печатать, текст и название попадают на сервер', async ({ page }) => {
    const id = await makeDoc(page, '', 'page')
    await openDoc(page, id)
    await page.getByLabel('Название документа').fill('Заметка')
    await page.locator('.md-add').click()
    await page.keyboard.type('Первая строка')
    await expect.poll(async () => (await docFull(page, id)).md, { timeout: 6000 }).toBe('Первая строка')
    expect((await docFull(page, id)).title).toBe('Заметка')
  })

  test('ссылка [[...]] на страницу вики открывает вики', async ({ page }) => {
    await openDocByTitle(page, 'Схема сервисов')
    await page.getByText('Соглашения по коду', { exact: true }).click()
    await expect(page.getByLabel('Название страницы')).toHaveValue('Соглашения по коду')
  })
})

test.describe('режим «Страница / Холст»', () => {
  test('переключение ничего не теряет: текст, название и объекты общие', async ({ page }) => {
    const id = await openDocByTitle(page, 'Схема сервисов')
    await expect(page.locator('.cv.edge')).toBeVisible()
    await expect(items(page)).toHaveCount(7)
    const md = (await docFull(page, id)).md

    await modeButton(page, 'Страница').click()
    await expect(page.locator('.cv.page')).toBeVisible()
    await expect(items(page)).toHaveCount(0)
    await expect(page.locator('.cv .wb-line')).toHaveCount(0)
    await expect(page.getByRole('toolbar', { name: 'Инструменты холста' })).toHaveCount(0)
    await expect(page.getByLabel('Название документа')).toHaveValue('Схема сервисов')
    await expect(page.locator('.md')).toContainText('Каждый сервис владеет своими данными')
    await expect(modeButton(page, 'Страница')).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => (await docFull(page, id)).mode).toBe('page')

    await modeButton(page, 'Холст').click()
    await expect(page.locator('.cv.edge')).toBeVisible()
    await expect(items(page)).toHaveCount(7)
    await expect(page.locator('.cv .wb-line')).toHaveCount(5)
    await expect.poll(async () => (await docFull(page, id)).mode).toBe('edge')

    const after = await docFull(page, id)
    expect(after.md).toBe(md)
    expect(after.rev).toBe(1) // режим версию текста не трогает
    expect(after.objects).toHaveLength(7)
    expect(after.links).toHaveLength(5)
  })

  test('режим документа виден в списке и сохраняется после перезапуска', async ({ page }) => {
    const id = await openDocByTitle(page, 'Планирование Q4')
    await modeButton(page, 'Холст').click()
    await expect(page.locator('.cv.edge')).toBeVisible()
    await expect.poll(async () => (await docFull(page, id)).mode).toBe('edge')
    await page.reload()
    await expect(page.locator('.cv.edge')).toBeVisible()
    await page.getByRole('button', { name: 'Все документы' }).click()
    await expect(cards(page).filter({ hasText: 'Планирование Q4' }).locator('.dmeta')).toContainText('Холст')
  })

  test('активный блок редактора остаётся открытым при переключении режима', async ({ page }) => {
    await openDocByTitle(page, 'Идеи по онбордингу')
    await blocks(page).first().click()
    await expect(editor(page)).toBeFocused()
    await page.keyboard.type('Х')
    await modeButton(page, 'Холст').click()
    await expect(page.locator('.cv.edge')).toBeVisible()
    await expect(page.locator('.md')).toContainText('Х')
  })

  test('режим переключили, не дожидаясь сохранения текста: ответ на текст не возвращает прежний режим', async ({ page }) => {
    const id = await openDocByTitle(page, 'Идеи по онбордингу')
    const isTextSave = (r: { method(): string; url(): string; postData(): string | null }) =>
      r.method() === 'PATCH' && r.url().endsWith(`/docs/${id}`) && !!r.postData()?.includes('"md"')
    // сервер обрабатывает текст сразу, но ответ доходит позже смены режима, и в нём режим ещё старый
    await page.route(`**/docs/${id}`, async (route) => {
      if (!isTextSave(route.request())) return route.continue()
      const response = await route.fetch()
      await new Promise((resolve) => setTimeout(resolve, 700))
      await route.fulfill({ response })
    })

    await blocks(page).first().click()
    await page.keyboard.type('Х')
    const staleAnswer = page.waitForResponse((r) => isTextSave(r.request()))
    await modeButton(page, 'Холст').click()
    await expect(page.locator('.cv.edge')).toBeVisible()
    await staleAnswer
    await page.waitForTimeout(300) // дать приложению время применить ответ: тогда экран остался бы на странице

    await expect(page.locator('.cv.edge')).toBeVisible()
    await expect(modeButton(page, 'Холст')).toHaveAttribute('aria-pressed', 'true')
    expect((await docFull(page, id)).mode).toBe('edge')
  })

  test('переключение режима сбрасывает выбранный объект и режим стрелок', async ({ page }) => {
    await openDocByTitle(page, 'Схема сервисов')
    await items(page).filter({ hasText: 'Клиент' }).click()
    await page.getByRole('button', { name: 'Стрелка' }).click()
    await expect(page.getByRole('button', { name: 'Стрелка' })).toHaveAttribute('aria-pressed', 'true')
    await modeButton(page, 'Страница').click()
    await modeButton(page, 'Холст').click()
    await expect(page.getByRole('button', { name: 'Стрелка' })).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByLabel('Текст выбранного объекта')).toHaveCount(0)
  })
})

test.describe('конфликт версий', () => {
  test('чужая правка во время моей: баннер, «Загрузить его версию» заменяет текст', async ({ page }) => {
    const id = await openDocByTitle(page, 'Идеи по онбордингу')
    // кто-то другой сохранил свою версию, пока документ открыт
    const theirs = await docFull(page, id)
    await api(page, `/docs/${id}`, { method: 'PATCH', data: { rev: theirs.rev, md: 'Текст соседа' } })

    await blocks(page).first().click()
    await editor(page).press('Control+End')
    await page.keyboard.type(' Моя правка')

    await expect(page.getByRole('alert')).toContainText('Документ изменил другой участник')
    await page.getByRole('button', { name: 'Загрузить его версию' }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.locator('.md')).toContainText('Текст соседа')
    await expect(page.locator('.md')).not.toContainText('Моя правка')
    expect((await docFull(page, id)).md).toBe('Текст соседа')
  })

  test('«Оставить мою» записывает свой текст поверх', async ({ page }) => {
    const id = await openDocByTitle(page, 'Идеи по онбордингу')
    const theirs = await docFull(page, id)
    await api(page, `/docs/${id}`, { method: 'PATCH', data: { rev: theirs.rev, md: 'Текст соседа' } })

    await blocks(page).first().click()
    await editor(page).press('Control+End')
    await page.keyboard.type(' Моя правка')
    await expect(page.getByRole('alert')).toBeVisible()
    await page.getByRole('button', { name: 'Оставить мою' }).click()

    await expect.poll(async () => (await docFull(page, id)).md, { timeout: 6000 }).toContain('Моя правка')
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('смена режима во время правки текста не даёт конфликта', async ({ page }) => {
    const id = await openDocByTitle(page, 'Идеи по онбордингу')
    await blocks(page).first().click()
    await editor(page).press('Control+End')
    await page.keyboard.type(' Правка')
    await modeButton(page, 'Холст').click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect.poll(async () => (await docFull(page, id)).md, { timeout: 6000 }).toContain('Правка')
    expect((await docFull(page, id)).mode).toBe('edge')
  })
})
