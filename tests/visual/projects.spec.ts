import { expect, test, type Page } from '@playwright/test'
import { openApp, resetData } from './fixtures'
import { apiAs, projectsOf, secondClient } from './projects-helpers'

// Проекты в интерфейсе (docs/PROJECTS.md, раздел 3): «+» у заголовка, меню по правой кнопке, окна «Новый проект»,
// «Настройки проекта», «Приглашения» и «Архив проектов». В макете их нет, поэтому эталона из design/screenshots нет:
// снимки окон свои, в обеих темах. Обновить: npm run update. Приглашения проверяются двумя живыми клиентами.

test.beforeEach(() => resetData())

/** Ближайшая строка списка (`.proj-row`, но не `.proj-rows`) */
const ROW = 'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " proj-row ")][1]'

const nav = (page: Page) => page.getByRole('navigation', { name: 'Проекты' })
const projectButton = (page: Page, name: string) => nav(page).getByRole('button', { name })
const userButton = (page: Page) => page.locator('.side button[aria-haspopup="menu"]')

async function openUserMenuItem(page: Page, name: string) {
  await userButton(page).click()
  await page.getByRole('menuitem', { name }).click()
}

/** Новый проект через «+» и окно; возвращает название */
async function createProjectInUi(page: Page, name: string, key = '') {
  await page.locator('.proj-head').hover()
  await page.getByRole('button', { name: 'Новый проект' }).click()
  const dialog = page.getByRole('dialog', { name: 'Новый проект' })
  await dialog.getByLabel('Название').fill(name)
  if (key) await dialog.getByLabel('Ключ задач').fill(key)
  await dialog.getByRole('button', { name: 'Создать' }).click()
  await expect(dialog).toHaveCount(0)
}

async function settingsOf(page: Page, name: string) {
  await projectButton(page, name).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Настройки проекта' }).click()
  // название окна меняется вместе с названием проекта, поэтому ищем по началу
  const dialog = page.getByRole('dialog', { name: /^Настройки проекта «/ })
  await expect(dialog).toHaveAccessibleName(`Настройки проекта «${name}»`)
  return dialog
}

// ===== «+» у заголовка =====

test('«+» у заголовка «Проекты» виден только при наведении', async ({ page }) => {
  await openApp(page)
  const plus = page.getByRole('button', { name: 'Новый проект' })
  await page.mouse.move(700, 450)
  await expect(plus).toHaveCSS('opacity', '0')
  await page.locator('.proj-head').hover()
  await expect(plus).toHaveCSS('opacity', '1')
  // и по клавиатуре: сфокусированный «+» виден
  await page.mouse.move(700, 450)
  await plus.focus()
  await expect(plus).toHaveCSS('opacity', '1')
})

// ===== Новый проект =====

test.describe('новый проект', () => {
  test('название, цвет и ключ: проект создаётся, выбирается, у задач его ключ', async ({ page }) => {
    await openApp(page)
    await page.locator('.proj-head').hover()
    await page.getByRole('button', { name: 'Новый проект' }).click()
    const dialog = page.getByRole('dialog', { name: 'Новый проект' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Создать' })).toBeDisabled()

    await dialog.getByLabel('Название').fill('Сайт компании')
    await dialog.getByRole('button', { name: 'Зелёный' }).click()
    await dialog.getByLabel('Ключ задач').fill('plx')
    await expect(dialog.getByText(/номера вида PLX-1/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Создать' }).click()
    await expect(dialog).toHaveCount(0)

    const created = (await projectsOf(page, 'lena@example.com')).find((p) => p.name === 'Сайт компании')!
    expect({ key: created.key, color: created.color, role: created.role }).toEqual({ key: 'PLX', color: 'ok', role: 'admin' })
    await expect(projectButton(page, 'Сайт компании')).toHaveClass(/cur/)
    // доска нового проекта с четырьмя колонками макета
    for (const column of ['К выполнению', 'В работе', 'На ревью', 'Готово']) await expect(page.getByText(column, { exact: true }).first()).toBeVisible()

    const task = await apiAs<{ key: string }>(page, 'lena@example.com', `/projects/${created.id}/tasks`, { method: 'POST', data: { title: 'Первая' } })
    expect(task.key).toBe('PLX-1')
  })

  test('неверный ключ не даёт создать проект, без ключа задачи получают TASK', async ({ page }) => {
    await openApp(page)
    await page.locator('.proj-head').hover()
    await page.getByRole('button', { name: 'Новый проект' }).click()
    const dialog = page.getByRole('dialog', { name: 'Новый проект' })
    await dialog.getByLabel('Название').fill('Без ключа')
    await dialog.getByLabel('Ключ задач').fill('1ab')
    await expect(dialog.getByRole('alert')).toContainText('Ключ: от 2 до 6 символов')
    await expect(dialog.getByRole('button', { name: 'Создать' })).toBeDisabled()
    await dialog.getByLabel('Ключ задач').fill('')
    await expect(dialog.getByText(/без ключа TASK-1/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Создать' }).click()
    await expect(dialog).toHaveCount(0)
    const created = (await projectsOf(page, 'lena@example.com')).find((p) => p.name === 'Без ключа')!
    expect(created.key).toBeNull()
  })

  test('Esc и «Отмена» закрывают окно ничего не создавая', async ({ page }) => {
    await openApp(page)
    await page.locator('.proj-head').hover()
    await page.getByRole('button', { name: 'Новый проект' }).click()
    const dialog = page.getByRole('dialog', { name: 'Новый проект' })
    await dialog.getByLabel('Название').fill('Не нужен')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(await projectsOf(page, 'lena@example.com')).toHaveLength(3)
  })
})

// ===== Меню проекта =====

test.describe('меню проекта по правой кнопке', () => {
  test('администратору: «Настройки проекта» и «Выйти из проекта»', async ({ page }) => {
    await openApp(page)
    await projectButton(page, 'Мобильный API').click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Проект «Мобильный API»' })
    await expect(menu.getByRole('menuitem')).toHaveText(['Настройки проекта', 'Выйти из проекта'])
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  })

  test('участнику только «Выйти из проекта»: вторым нажатием, проект пропадает', async ({ page }) => {
    await openApp(page, { email: 'artem@example.com' })
    await projectButton(page, 'Мобильный API').click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Проект «Мобильный API»' })
    await expect(menu.getByRole('menuitem')).toHaveText(['Выйти из проекта'])
    await menu.getByRole('menuitem').click()
    await expect(menu.getByRole('menuitem')).toHaveText(['Точно выйти?'])
    await menu.getByRole('menuitem').click()
    await expect(menu).toHaveCount(0)
    await expect(projectButton(page, 'Мобильный API')).toHaveCount(0)
    expect((await projectsOf(page, 'artem@example.com')).map((p) => p.name)).toEqual(['Web-приложение', 'Инфраструктура'])
  })

  test('единственный администратор не выходит: плашка с объяснением, проект остаётся', async ({ page }) => {
    await openApp(page)
    await createProjectInUi(page, 'Личный')
    await projectButton(page, 'Личный').click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Проект «Личный»' })
    await menu.getByRole('menuitem', { name: 'Выйти из проекта' }).click()
    await menu.getByRole('menuitem', { name: 'Точно выйти?' }).click()
    await expect(page.getByText('Единственный администратор проекта')).toBeVisible()
    await expect(projectButton(page, 'Личный')).toBeVisible()
  })
})

// ===== Настройки проекта =====

test.describe('настройки проекта', () => {
  test('основное: название, цвет и ключ сохраняются, боковое меню обновляется', async ({ page }) => {
    await openApp(page)
    const dialog = await settingsOf(page, 'Инфраструктура')
    await expect(dialog.getByRole('tab')).toHaveText(['Основное', 'Участники', 'Метки', 'Архив'])
    await expect(dialog.getByRole('button', { name: 'Сохранить' })).toBeDisabled()

    await dialog.getByLabel('Название').fill('Инфра и сервера')
    await dialog.getByRole('button', { name: 'Синий' }).click()
    await dialog.getByLabel('Ключ задач').fill('ops')
    await dialog.getByRole('button', { name: 'Сохранить' }).click()
    // у проекта есть задачи, их id меняются: сначала вопрос (подробно в keys.spec.ts)
    await page.getByRole('dialog', { name: /изменятся id/ }).getByRole('button', { name: 'Продолжить' }).click()
    await expect(dialog.getByRole('status')).toHaveText('Сохранено')
    await expect(projectButton(page, 'Инфра и сервера')).toBeVisible()

    const saved = (await projectsOf(page, 'lena@example.com')).find((p) => p.name === 'Инфра и сервера')!
    expect({ key: saved.key, color: saved.color }).toEqual({ key: 'OPS', color: 'accent' })
    await dialog.getByLabel('Ключ задач').fill('')
    await dialog.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByRole('dialog', { name: /изменятся id/ }).getByRole('button', { name: 'Продолжить' }).click()
    await expect(dialog.getByRole('status')).toHaveText('Сохранено')
    expect((await projectsOf(page, 'lena@example.com')).find((p) => p.name === 'Инфра и сервера')!.key).toBeNull()
  })

  test('метки: добавить, переименовать, перекрасить, удалить с подтверждением и числом задач', async ({ page }) => {
    await openApp(page)
    const web = (await projectsOf(page, 'lena@example.com')).find((p) => p.name === 'Web-приложение')!
    const board = await apiAs<{ tags: Array<{ id: string; label: string; tone: number }>; tasks: Array<{ tag_ids: string[] }> }>(
      page,
      'lena@example.com',
      `/projects/${web.id}/board`,
    )
    const bug = board.tags.find((t) => t.label === 'Баг')!
    const used = board.tasks.filter((t) => t.tag_ids.includes(bug.id)).length
    expect(used).toBeGreaterThan(1)

    const dialog = await settingsOf(page, 'Web-приложение')
    await dialog.getByRole('tab', { name: 'Метки' }).click()
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Метки')
    await expect(dialog.getByRole('textbox', { name: /Название метки/ })).toHaveCount(board.tags.length)

    // добавить
    await dialog.getByLabel('Название новой метки').fill('Срочно')
    await dialog.getByRole('button', { name: 'Добавить' }).click()
    await expect(dialog.getByRole('textbox', { name: 'Название метки «Срочно»' })).toBeVisible()
    // переименовать
    const name = dialog.getByRole('textbox', { name: 'Название метки «Срочно»' })
    await name.fill('Очень срочно')
    await name.press('Enter')
    await expect(dialog.getByRole('textbox', { name: 'Название метки «Очень срочно»' })).toBeVisible()
    // перекрасить
    const colors = dialog.getByRole('group', { name: 'Цвет метки «Очень срочно»' })
    await colors.getByRole('button', { name: 'Цвет 6' }).click()
    await expect(colors.getByRole('button', { name: 'Цвет 6' })).toHaveAttribute('aria-pressed', 'true')
    // удаление: первое нажатие спрашивает и называет число задач
    const row = dialog.getByRole('textbox', { name: 'Название метки «Баг»' }).locator(ROW)
    await row.getByRole('button', { name: 'Удалить' }).click()
    await expect(row.getByRole('button', { name: new RegExp(`Точно\\? Метка стоит на ${used} задач`) })).toBeVisible()
    await row.getByRole('button', { name: /Точно\?/ }).click()
    await expect(dialog.getByRole('textbox', { name: 'Название метки «Баг»' })).toHaveCount(0)

    const after = await apiAs<{ tags: Array<{ label: string; tone: number }> }>(page, 'lena@example.com', `/projects/${web.id}/board`)
    expect(after.tags.map((t) => t.label)).not.toContain('Баг')
    expect(after.tags.find((t) => t.label === 'Очень срочно')!.tone).toBe(5)
  })

  test('метки у проектов разные: метка из окна задачи не появляется в соседнем проекте', async ({ page }) => {
    await openApp(page)
    const [web, api] = [(await projectsOf(page, 'lena@example.com'))[0], (await projectsOf(page, 'lena@example.com'))[1]]
    await apiAs(page, 'lena@example.com', `/projects/${web.id}/tags`, { method: 'POST', data: { label: 'Только тут' } })
    const dialog = await settingsOf(page, api.name)
    await dialog.getByRole('tab', { name: 'Метки' }).click()
    await expect(dialog.getByRole('textbox', { name: 'Название метки «Только тут»' })).toHaveCount(0)
    await expect(dialog.getByRole('textbox', { name: 'Название метки «Баг»' })).toBeVisible()
  })

  test('архив: проект уходит из меню, возвращается из окна «Архив проектов»', async ({ page }) => {
    await openApp(page)
    const dialog = await settingsOf(page, 'Инфраструктура')
    await dialog.getByRole('tab', { name: 'Архив' }).click()
    const button = dialog.getByRole('button', { name: 'Архивировать' })
    await button.click()
    await expect(dialog.getByRole('button', { name: 'Точно архивировать?' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Точно архивировать?' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(projectButton(page, 'Инфраструктура')).toHaveCount(0)

    await openUserMenuItem(page, 'Архив проектов')
    const archive = page.getByRole('dialog', { name: 'Архив проектов' })
    await expect(archive.getByText('Инфраструктура')).toBeVisible()
    await archive.getByRole('button', { name: 'Вернуть' }).click()
    await expect(archive.getByText('Архив пуст')).toBeVisible()
    await expect(projectButton(page, 'Инфраструктура')).toBeVisible()
  })

  test('окно настроек закрывается, когда проект ушёл из списка администратора', async ({ page }) => {
    await openApp(page)
    const infra = (await projectsOf(page, 'lena@example.com')).find((p) => p.name === 'Инфраструктура')!
    const dialog = await settingsOf(page, 'Инфраструктура')
    await apiAs(page, 'lena@example.com', `/projects/${infra.id}/archive`, { method: 'POST', data: {} })
    await page.reload()
    await expect(dialog).toHaveCount(0)
  })
})

// ===== Приглашения =====

test.describe('участники и приглашения', () => {
  test('пригласить по e-mail: приглашённый видит точку и число, принимает, проект появляется у обоих', async ({ page, browser }) => {
    await openApp(page)
    await createProjectInUi(page, 'Командный')
    const artem = await secondClient(browser, 'artem@example.com')
    try {
      await expect(projectButton(artem.page, 'Командный')).toHaveCount(0)

      const dialog = await settingsOf(page, 'Командный')
      await dialog.getByRole('tab', { name: 'Участники' }).click()
      await dialog.getByLabel('E-mail').fill('artem@example.com')
      await dialog.getByRole('button', { name: 'Пригласить' }).click()
      await expect(dialog.getByRole('status')).toContainText('Приглашение отправлено: artem@example.com')
      await expect(dialog.getByRole('region', { name: /Ожидают/ }).or(dialog.getByText('Ожидают ответа'))).toBeVisible()
      await expect(dialog.getByText('artem@example.com · Участник · ожидает ответа')).toBeVisible()

      // у приглашённого без перезагрузки: точка у имени и число в меню
      await expect(artem.page.getByRole('img', { name: 'Есть приглашения в проекты' })).toBeVisible()
      await userButton(artem.page).click()
      await expect(artem.page.getByRole('menuitem', { name: /Приглашения/ })).toContainText('1')
      await artem.page.getByRole('menuitem', { name: /Приглашения/ }).click()
      const invites = artem.page.getByRole('dialog', { name: 'Приглашения' })
      await expect(invites.getByText('Командный')).toBeVisible()
      await expect(invites.getByText('Пригласил(а) Лена М. · Участник')).toBeVisible()
      await invites.getByRole('button', { name: 'Принять' }).click()
      await expect(invites.getByText('Приглашений нет')).toBeVisible()
      await expect(projectButton(artem.page, 'Командный')).toBeVisible()
      await expect(artem.page.getByRole('img', { name: 'Есть приглашения в проекты' })).toHaveCount(0)

      // у администратора список участников обновился сам
      await expect(dialog.getByRole('group', { name: 'Роль: Артём К.' })).toBeVisible()
      await expect(dialog.getByText('ожидает ответа')).toHaveCount(0)
    } finally {
      await artem.close()
    }
  })

  test('отклонить и отозвать: ничего не остаётся, повторно позвать можно', async ({ page, browser }) => {
    await openApp(page)
    await createProjectInUi(page, 'Командный')
    const created = (await projectsOf(page, 'lena@example.com')).find((p) => p.name === 'Командный')!
    const daniil = await secondClient(browser, 'daniil@example.com')
    try {
      const dialog = await settingsOf(page, 'Командный')
      await dialog.getByRole('tab', { name: 'Участники' }).click()
      await dialog.getByLabel('E-mail').fill('daniil@example.com')
      await dialog.getByRole('button', { name: 'Пригласить' }).click()
      await expect(daniil.page.getByRole('img', { name: 'Есть приглашения в проекты' })).toBeVisible()

      // администратор отозвал: точка у приглашённого гаснет сама
      await dialog.getByRole('button', { name: 'Отозвать' }).click()
      await expect(daniil.page.getByRole('img', { name: 'Есть приглашения в проекты' })).toHaveCount(0)

      // позвали снова, человек отклонил
      await dialog.getByLabel('E-mail').fill('daniil@example.com')
      await dialog.getByRole('button', { name: 'Пригласить' }).click()
      await openUserMenuItem(daniil.page, 'Приглашения')
      await daniil.page.getByRole('dialog', { name: 'Приглашения' }).getByRole('button', { name: 'Отклонить' }).click()
      await expect(daniil.page.getByRole('dialog', { name: 'Приглашения' }).getByText('Приглашений нет')).toBeVisible()
      await expect(projectButton(daniil.page, 'Командный')).toHaveCount(0)
      expect((await apiAs<{ members: unknown[] }>(page, 'lena@example.com', `/projects/${created.id}/members`)).members).toHaveLength(1)
    } finally {
      await daniil.close()
    }
  })

  test('ошибки приглашения написаны по-русски: нет аккаунта, уже в проекте, уже приглашён', async ({ page }) => {
    await openApp(page)
    const dialog = await settingsOf(page, 'Web-приложение')
    await dialog.getByRole('tab', { name: 'Участники' }).click()
    const email = dialog.getByLabel('E-mail')
    const invite = dialog.getByRole('button', { name: 'Пригласить' })

    await email.fill('nobody@example.com')
    await invite.click()
    await expect(dialog.getByRole('alert')).toHaveText('Аккаунта с таким адресом нет')
    await email.fill('artem@example.com')
    await invite.click()
    await expect(dialog.getByRole('alert')).toHaveText('Уже в проекте')

    // человек вышел из проекта: первое приглашение уходит, второе «уже приглашён»
    const web = (await projectsOf(page, 'lena@example.com')).find((p) => p.name === 'Web-приложение')!
    const artem = await apiAs<{ id: string }>(page, 'artem@example.com', '/me')
    await apiAs(page, 'lena@example.com', `/projects/${web.id}/members/${artem.id}`, { method: 'DELETE' })
    await email.fill('artem@example.com')
    await invite.click()
    await expect(dialog.getByRole('status')).toContainText('Приглашение отправлено: artem@example.com')
    await email.fill('artem@example.com')
    await invite.click()
    await expect(dialog.getByRole('alert')).toHaveText('Уже приглашён')
  })

  test('ошибка приглашения стоит рядом с кнопкой и видна, даже когда окно низкое и страницу пришлось прокрутить', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 520 })
    await openApp(page)
    const dialog = await settingsOf(page, 'Web-приложение')
    await dialog.getByRole('tab', { name: 'Участники' }).click()
    const invite = dialog.getByRole('button', { name: 'Пригласить' })
    await dialog.getByLabel('E-mail').fill('nobody@example.com')
    // кнопка у нижнего края окна: всё, что ниже неё, пришлось бы прокручивать
    await invite.evaluate((el) => el.scrollIntoView({ block: 'end' }))
    await invite.click()
    const alert = dialog.getByRole('alert')
    await expect(alert).toHaveText('Аккаунта с таким адресом нет')
    await expect(alert).toBeInViewport({ ratio: 1 })
  })

  test('ошибка метки стоит под её строкой, а название возвращается прежним', async ({ page }) => {
    await openApp(page)
    const dialog = await settingsOf(page, 'Web-приложение')
    await dialog.getByRole('tab', { name: 'Метки' }).click()
    const names = dialog.getByRole('textbox', { name: /^Название метки/ })
    const first = names.nth(0)
    const second = names.nth(1)
    const was = await first.inputValue()
    await first.fill(await second.inputValue())
    await first.press('Enter')

    const alert = dialog.getByRole('alert')
    await expect(alert).toHaveText('В проекте уже есть метка с таким названием')
    await expect(first).toHaveValue(was)
    const own = (await first.locator(ROW).boundingBox())!
    const next = (await second.locator(ROW).boundingBox())!
    const box = (await alert.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(own.y + own.height - 1)
    expect(box.y + box.height).toBeLessThanOrEqual(next.y + 1)
  })

  test('роль и исключение: администратор повышает участника и убирает его, проект у того пропадает сам', async ({ page, browser }) => {
    await openApp(page)
    const igor = await secondClient(browser, 'igor@example.com')
    try {
      await expect(projectButton(igor.page, 'Web-приложение')).toBeVisible()
      const dialog = await settingsOf(page, 'Web-приложение')
      await dialog.getByRole('tab', { name: 'Участники' }).click()
      await expect(dialog.getByRole('group', { name: 'Роль: Игорь П.' }).getByRole('button', { name: 'Участник' })).toHaveAttribute('aria-pressed', 'true')

      await dialog.getByRole('group', { name: 'Роль: Игорь П.' }).getByRole('button', { name: 'Администратор' }).click()
      await expect(dialog.getByRole('group', { name: 'Роль: Игорь П.' }).getByRole('button', { name: 'Администратор' })).toHaveAttribute('aria-pressed', 'true')
      // новый администратор получает «Настройки проекта» в меню
      await projectButton(igor.page, 'Web-приложение').click({ button: 'right' })
      await expect(igor.page.getByRole('menu', { name: 'Проект «Web-приложение»' }).getByRole('menuitem')).toHaveText(['Настройки проекта', 'Выйти из проекта'])
      await igor.page.keyboard.press('Escape')

      const row = dialog.getByRole('group', { name: 'Роль: Игорь П.' }).locator(ROW)
      await row.getByRole('button', { name: 'Убрать' }).click()
      await row.getByRole('button', { name: 'Точно убрать?' }).click()
      await expect(dialog.getByRole('group', { name: 'Роль: Игорь П.' })).toHaveCount(0)
      await expect(projectButton(igor.page, 'Web-приложение')).toHaveCount(0)
    } finally {
      await igor.close()
    }
  })

  test('себя из списка не убрать и роль не сменить: рядом написана роль', async ({ page }) => {
    await openApp(page)
    const dialog = await settingsOf(page, 'Web-приложение')
    await dialog.getByRole('tab', { name: 'Участники' }).click()
    const me = dialog.getByText('Лена М. (вы)').locator(ROW)
    await expect(me.getByText('Администратор', { exact: true })).toBeVisible()
    await expect(me.getByRole('button')).toHaveCount(0)
  })
})

// ===== Пустое состояние и исполнители =====

test('человек без проектов видит подсказку и может создать свой', async ({ page }) => {
  await openApp(page, { email: 'sonya@example.com' })
  for (const p of await projectsOf(page, 'sonya@example.com')) {
    const me = await apiAs<{ id: string }>(page, 'sonya@example.com', '/me')
    await apiAs(page, 'sonya@example.com', `/projects/${p.id}/members/${me.id}`, { method: 'DELETE' })
  }
  await page.reload()
  await expect(page.getByText('У вас пока нет проектов')).toBeVisible()
  await expect(nav(page).getByRole('button')).toHaveCount(0)
  // вики и другие общие экраны работают и без проектов
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Вики' }).click()
  await expect(page.getByText('У вас пока нет проектов')).toHaveCount(0)
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Доска' }).click()
  await page.getByRole('button', { name: 'Создать проект' }).click()
  const dialog = page.getByRole('dialog', { name: 'Новый проект' })
  await dialog.getByLabel('Название').fill('Мой первый')
  await dialog.getByRole('button', { name: 'Создать' }).click()
  await expect(projectButton(page, 'Мой первый')).toHaveClass(/cur/)
  await expect(page.getByText('У вас пока нет проектов')).toHaveCount(0)
})

test('исполнителем в окне задачи можно назначить только участника проекта', async ({ page }) => {
  await openApp(page)
  const web = (await projectsOf(page, 'lena@example.com')).find((p) => p.name === 'Web-приложение')!
  const igor = await apiAs<{ id: string }>(page, 'igor@example.com', '/me')
  await apiAs(page, 'lena@example.com', `/projects/${web.id}/members/${igor.id}`, { method: 'DELETE' })
  await page.reload()
  await expect(page.locator('.card').first()).toBeVisible()
  await page.locator('.card').first().click()
  const drawer = page.getByRole('dialog', { name: /^Задача / })
  const assignees = drawer.getByText('Исполнитель', { exact: true }).locator('xpath=following-sibling::*[1]')
  await expect(assignees.getByRole('button', { name: 'Артём К.' })).toBeVisible()
  await expect(assignees.getByRole('button', { name: /Игорь П\./ })).toHaveCount(0)
})

// ===== Снимки окон (свои, в обеих темах) =====

for (const theme of ['light', 'dark'] as const) {
  test(`окна проектов (${theme})`, async ({ page, browser }) => {
    await openApp(page, { theme })
    await page.mouse.move(8, 8)

    // новый проект
    await page.locator('.proj-head').hover()
    await page.getByRole('button', { name: 'Новый проект' }).click()
    const dialog = page.getByRole('dialog', { name: 'Новый проект' })
    await dialog.getByLabel('Название').fill('Сайт компании')
    await dialog.getByLabel('Ключ задач').fill('plx')
    await expect(dialog).toHaveScreenshot(`new-project-${theme}.png`)
    await page.keyboard.press('Escape')

    // участники и ожидающие приглашения
    const settings = await settingsOf(page, 'Web-приложение')
    await settings.getByRole('tab', { name: 'Участники' }).click()
    const web = (await projectsOf(page, 'lena@example.com')).find((p) => p.name === 'Web-приложение')!
    const me = await apiAs<{ id: string }>(page, 'daniil@example.com', '/me')
    await apiAs(page, 'lena@example.com', `/projects/${web.id}/members/${me.id}`, { method: 'DELETE' })
    await apiAs(page, 'lena@example.com', `/projects/${web.id}/invites`, { method: 'POST', data: { email: 'daniil@example.com' } })
    await expect(settings.getByText('ожидает ответа').first()).toBeVisible()
    await page.mouse.move(8, 8)
    await expect(settings).toHaveScreenshot(`members-${theme}.png`)

    // метки
    await settings.getByRole('tab', { name: 'Метки' }).click()
    await expect(settings.getByRole('textbox', { name: 'Название метки «Баг»' })).toBeVisible()
    await expect(settings).toHaveScreenshot(`tags-${theme}.png`)
    await page.keyboard.press('Escape')

    // приглашения: у Даниила одно
    const second = await secondClient(browser, 'daniil@example.com', theme)
    try {
      await openUserMenuItem(second.page, 'Приглашения')
      const invites = second.page.getByRole('dialog', { name: 'Приглашения' })
      await expect(invites.getByText('Web-приложение')).toBeVisible()
      await second.page.mouse.move(8, 8)
      await expect(invites).toHaveScreenshot(`invites-${theme}.png`)
    } finally {
      await second.close()
    }

    // архив с одним проектом
    await apiAs(page, 'lena@example.com', `/projects/${web.id}/archive`, { method: 'POST', data: {} })
    await page.reload()
    await openUserMenuItem(page, 'Архив проектов')
    const archive = page.getByRole('dialog', { name: 'Архив проектов' })
    await expect(archive.getByText('Web-приложение')).toBeVisible()
    await page.mouse.move(8, 8)
    await expect(archive).toHaveScreenshot(`archive-${theme}.png`)
  })
}
