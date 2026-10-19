// Редактор markdown: клавиши, панель форматирования, отрисованные блоки. Что за клавишей стоит, разобрано юнит-тестами
// и сверкой с макетом (app/src/lib/markdown); здесь проверяется, что всё это подключено в живом окне.

import { expect, test } from '@playwright/test'
import { resetData } from './fixtures'
import { blocks, editor, expectSaved, makePage, openPageById } from './wiki-helpers'

test.beforeEach(() => resetData())

test.describe('клавиши', () => {
  test('Enter в списке продолжает список, на пустом пункте выходит из списка', async ({ page }) => {
    const id = await makePage(page, 'Список', '- один')
    await openPageById(page, id)
    await blocks(page).first().click()
    await page.keyboard.press('Enter')
    await expect(editor(page)).toHaveValue('- один\n- ')
    await page.keyboard.type('два')
    await page.keyboard.press('Enter')
    await expect(editor(page)).toHaveValue('- один\n- два\n- ')
    await page.keyboard.press('Enter') // пустой пункт
    await expect(editor(page)).toHaveValue('')
    await page.keyboard.type('Абзац')
    await page.keyboard.press('Escape')
    await expect(editor(page)).toHaveCount(0)
    await expectSaved(page, id, '- один\n- два\n\nАбзац')
  })

  test('нумерованный список продолжается с нумерацией', async ({ page }) => {
    const id = await makePage(page, 'Номера', '1. раз')
    await openPageById(page, id)
    await blocks(page).first().click()
    await page.keyboard.press('Enter')
    await expect(editor(page)).toHaveValue('1. раз\n2. ')
    await page.keyboard.press('Escape')
    await expectSaved(page, id, '1. раз')
  })

  test('в списке задач новый пункт появляется с пустой галочкой', async ({ page }) => {
    const id = await makePage(page, 'Задачи', '- [x] сделано')
    await openPageById(page, id)
    await blocks(page).first().locator('.li-t').click()
    await page.keyboard.press('Enter')
    await expect(editor(page)).toHaveValue('- [x] сделано\n- [ ] ')
  })

  test('Enter в абзаце делит блок по курсору', async ({ page }) => {
    const id = await makePage(page, 'Делим', 'АБВГД')
    await openPageById(page, id)
    await blocks(page).first().click()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Enter')
    await expect(editor(page)).toHaveValue('ГД')
    await expect(blocks(page)).toHaveCount(1)
    await expect(blocks(page).first()).toHaveText('АБВ')
    await page.keyboard.press('Escape')
    await expectSaved(page, id, 'АБВ\n\nГД')
  })

  test('Backspace на пустом блоке удаляет его и переходит к предыдущему', async ({ page }) => {
    const id = await makePage(page, 'Стираем', 'Раз\n\nДва')
    await openPageById(page, id)
    await blocks(page).first().click()
    await page.keyboard.press('ArrowDown') // в конце блока: к следующему
    await expect(editor(page)).toHaveValue('Два')
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Backspace')
    await expect(editor(page)).toHaveValue('')
    await page.keyboard.press('Backspace') // уже пустой
    await expect(editor(page)).toHaveValue('Раз')
    await expect(editor(page)).toBeFocused()
    await page.keyboard.press('Escape')
    await expectSaved(page, id, 'Раз')
  })

  test('стрелки на краях блока переходят в соседние блоки', async ({ page }) => {
    const id = await makePage(page, 'Стрелки', 'А\n\nБ\n\nВ')
    await openPageById(page, id)
    await blocks(page).nth(1).click()
    await expect(editor(page)).toHaveValue('Б')
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowUp')
    await expect(editor(page)).toHaveValue('А')
    await page.keyboard.press('ArrowDown') // курсор в конце «А»
    await expect(editor(page)).toHaveValue('Б')
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowDown')
    await expect(editor(page)).toHaveValue('В')
    await page.keyboard.press('ArrowDown') // дальше блоков нет: остаётся на месте
    await expect(editor(page)).toHaveValue('В')
  })

  test('Tab сдвигает пункт списка, Shift+Tab возвращает', async ({ page }) => {
    const id = await makePage(page, 'Вложенность', '- один\n- два')
    await openPageById(page, id)
    await blocks(page).first().click()
    await page.keyboard.press('Tab')
    await expect(editor(page)).toHaveValue('- один\n  - два')
    await page.keyboard.press('Shift+Tab')
    await expect(editor(page)).toHaveValue('- один\n- два')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Escape')
    await expectSaved(page, id, '- один\n  - два')
    // вложенный пункт нарисован со сдвигом
    await expect(blocks(page).first().locator('.li').nth(1)).toHaveCSS('padding-left', '22px')
  })

  test('Esc убирает пустые маркеры и лишние пустые строки', async ({ page }) => {
    const id = await makePage(page, 'Уборка', 'Текст')
    await openPageById(page, id)
    await page.locator('.md-add').click()
    await expect(editor(page)).toBeFocused()
    await page.keyboard.type('- ')
    await page.keyboard.press('Escape')
    await expect(editor(page)).toHaveCount(0)
    await expectSaved(page, id, 'Текст')
  })

  test('Ctrl+Enter завершает редактирование', async ({ page }) => {
    const id = await makePage(page, 'Выход', 'Строка')
    await openPageById(page, id)
    await blocks(page).first().click()
    await page.keyboard.type(' и ещё')
    await page.keyboard.press('Control+Enter')
    await expect(editor(page)).toHaveCount(0)
    await expect(blocks(page).first()).toHaveText('Строка и ещё')
  })

  test('Ctrl+B и Ctrl+I оборачивают выделенное, панель делает то же и не отнимает фокус', async ({ page }) => {
    const id = await makePage(page, 'Жирный', 'слово')
    await openPageById(page, id)
    await blocks(page).first().click()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+b')
    await expect(editor(page)).toHaveValue('**слово**')
    await page.keyboard.press('Control+a')
    await page.getByRole('button', { name: 'Курсив (Ctrl+I)' }).click()
    await expect(editor(page)).toHaveValue('***слово***')
    await expect(editor(page)).toBeFocused()
    await page.keyboard.press('Escape')
    await expectSaved(page, id, '***слово***')
  })

  test('Enter на отрисованном блоке открывает его для правки с клавиатуры', async ({ page }) => {
    const id = await makePage(page, 'Клавиатура', 'Блок')
    await openPageById(page, id)
    await blocks(page).first().focus()
    await page.keyboard.press('Enter')
    await expect(editor(page)).toBeFocused()
    await expect(editor(page)).toHaveValue('Блок')
  })
})

test.describe('панель форматирования и блоки', () => {
  test('кнопки панели вставляют новый блок после активного', async ({ page }) => {
    const id = await makePage(page, 'Панель', 'Текст')
    await openPageById(page, id)
    await blocks(page).first().click()
    await page.getByRole('button', { name: 'Заголовок 2' }).click()
    await expect(editor(page)).toHaveValue('## ')
    await page.keyboard.type('Раздел')
    await page.getByRole('button', { name: 'Список задач' }).click()
    await expect(editor(page)).toHaveValue('- [ ] ')
    await page.keyboard.type('Дело')
    await page.getByRole('button', { name: 'Блок кода' }).click()
    await expect(editor(page)).toHaveValue('```\n\n```')
    await page.keyboard.type('x = 1')
    await page.keyboard.press('Escape')
    await expectSaved(page, id, 'Текст\n\n## Раздел\n\n- [ ] Дело\n\n```\nx = 1\n```')
    await expect(blocks(page)).toHaveCount(4)
    await expect(page.locator('.md-code code')).toHaveText('x = 1')
  })

  test('на пустой странице видна подсказка, кнопка «Таблица» вставляет таблицу, Enter добавляет строку', async ({ page }) => {
    const id = await makePage(page, 'Пустая', '')
    await openPageById(page, id)
    await expect(page.locator('.md-add')).toHaveText('Нажми, чтобы начать писать')
    await page.getByRole('button', { name: 'Таблица' }).click()
    const header = '| Колонка 1 | Колонка 2 | Колонка 3 |\n| --- | --- | --- |\n|  |  |  |'
    await expect(editor(page)).toHaveValue(header)
    await page.keyboard.press('Enter')
    await expect(editor(page)).toHaveValue(`${header}\n|  |  |  |`)
    await page.keyboard.press('Escape')
    await expect(page.locator('.md-cell')).toHaveCount(9)
    await expect(page.locator('.md-cell.head')).toHaveCount(3)
  })

  test('галочка в списке переключается кликом без перехода к правке и сохраняется', async ({ page }) => {
    const id = await makePage(page, 'Галочки', '- [ ] Один\n- [x] Два')
    await openPageById(page, id)
    const ticks = blocks(page).first().getByRole('button', { name: 'Отметить пункт' })
    await ticks.first().click()
    await expect(editor(page)).toHaveCount(0)
    await expect(page.locator('.li-t.done')).toHaveCount(2)
    await expectSaved(page, id, '- [x] Один\n- [x] Два')
    await ticks.nth(1).click()
    await expectSaved(page, id, '- [x] Один\n- [ ] Два')
  })

  test('клик по другому блоку переключает правку без потери текста', async ({ page }) => {
    const id = await makePage(page, 'Переход', 'Первый\n\nВторой')
    await openPageById(page, id)
    await blocks(page).first().click()
    await page.keyboard.type('!')
    await blocks(page).first().click() // «Второй» теперь первый из отрисованных блоков
    await expect(editor(page)).toHaveValue('Второй')
    await expect(blocks(page).first()).toHaveText('Первый!')
    await page.keyboard.press('Escape')
    await expectSaved(page, id, 'Первый!\n\nВторой')
  })

  test('потеря фокуса завершает правку', async ({ page }) => {
    const id = await makePage(page, 'Фокус', 'Текст')
    await openPageById(page, id)
    await blocks(page).first().click()
    await page.keyboard.type(' тут')
    await page.getByLabel('Название страницы').click()
    await expect(editor(page)).toHaveCount(0)
    await expect(blocks(page).first()).toHaveText('Текст тут')
  })

  test('разметка внутри строки: жирный, курсив, код, зачёркнутый, тег', async ({ page }) => {
    const id = await makePage(page, 'Разметка', 'а **жирный** б *курсив* в `код` г ~~вычеркнут~~ д #тег')
    await openPageById(page, id)
    const line = blocks(page).first()
    await expect(line.locator('.il.b')).toHaveText('жирный')
    await expect(line.locator('.il.i')).toHaveText('курсив')
    await expect(line.locator('.il.c')).toHaveText('код')
    await expect(line.locator('.il.s')).toHaveText('вычеркнут')
    await expect(line.locator('.il.tg')).toHaveText('#тег')
  })

  test('выноска получает название по умолчанию, блок кода показывает язык', async ({ page }) => {
    const id = await makePage(page, 'Блоки', '> [!tip]\n> текст выноски\n\n```bash\nmake\n```')
    await openPageById(page, id)
    await expect(page.locator('.mt.callout .co-title')).toHaveText('Совет')
    await expect(page.locator('.md-lang')).toHaveText('bash')
  })
})

test.describe('ссылки', () => {
  test('[[Страница]] открывает страницу, а ссылка на несуществующую помечена', async ({ page }) => {
    const id = await makePage(page, 'Ссылки', 'Смотри [[Начало работы]] и [[Нет такой страницы]]')
    await openPageById(page, id)
    await expect(page.locator('.il.wl')).toHaveCount(2)
    await expect(page.locator('.il.wl.miss')).toHaveText('Нет такой страницы')
    await page.locator('.il.wl:not(.miss)').click()
    await expect(editor(page)).toHaveCount(0) // клик по ссылке не открывает блок для правки
    await expect(page.getByLabel('Название страницы')).toHaveValue('Начало работы')
  })

  test('ссылка на несуществующую страницу создаёт её и открывает с курсором', async ({ page }) => {
    const id = await makePage(page, 'Источник', 'Нужна [[Свежая страница]]')
    await openPageById(page, id)
    await page.locator('.il.wl.miss').click()
    await expect(page.getByLabel('Название страницы')).toHaveValue('Свежая страница')
    await expect(editor(page)).toBeFocused()
    await expect(page.getByRole('treeitem', { name: 'Свежая страница' })).toBeVisible()
    // а теперь ссылка в исходной странице уже не помечена
    await page.getByRole('treeitem', { name: 'Источник' }).click()
    await expect(page.locator('.il.wl.miss')).toHaveCount(0)
  })

  test('название страницы в ссылке сопоставляется без учёта регистра', async ({ page }) => {
    const id = await makePage(page, 'Регистр', '[[начало РАБОТЫ|подпись]]')
    await openPageById(page, id)
    await expect(page.locator('.il.wl')).toHaveText('подпись')
    await expect(page.locator('.il.wl.miss')).toHaveCount(0)
  })

  test('внешняя ссылка открывается в новой вкладке', async ({ page, context }) => {
    await context.route('https://example.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }))
    const id = await makePage(page, 'Сайт', 'Вот [так](https://example.com/page) и [вот](javascript:alert(1))')
    await openPageById(page, id)
    const [popup] = await Promise.all([context.waitForEvent('page'), page.locator('.il.lk').first().click()])
    expect(popup.url()).toBe('https://example.com/page')
    await popup.close()
    // небезопасный адрес не открывается и не открывает блок
    await page.locator('.il.lk').nth(1).click()
    await expect(editor(page)).toHaveCount(0)
    expect(context.pages()).toHaveLength(1)
  })
})
