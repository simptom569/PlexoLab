import { expect, test, type Page } from '@playwright/test'
import { DEMO_TEAM, openApp, resetData } from './fixtures'
import { apiAs, dreamTeamAs, secondClient } from './projects-helpers'

// Команды в интерфейсе (docs/TEAMS.md, раздел 11, вариант Б): переключатель в блоке PlexoLab, меню команды по правой кнопке,
// окна «Новая команда», «Настройки команды», «Участники», «Все команды сервера», «Приглашения» и «Архив проектов» с двумя
// разделами, видимость проекта с подтверждением, гостевая команда. В макете этого нет: снимки окон свои, в обеих темах
// (эталона из design/screenshots нет). Обновить: npm run update. Приглашения и гость проверяются двумя живыми клиентами.

test.beforeEach(() => resetData())

const LENA = 'lena@example.com'
const ARTEM = 'artem@example.com'
const IGOR = 'igor@example.com'

type Team = { id: string; name: string; personal: boolean; role: string | null; guest: boolean; wiki: boolean; guests_read_wiki?: boolean }

const brand = (page: Page) => page.locator('.side .brand-btn')
const caption = (page: Page) => brand(page).locator('.cap > span').first()
const teamMenu = (page: Page) => page.getByRole('menu', { name: 'Команды' })
const nav = (page: Page) => page.getByRole('navigation', { name: 'Проекты' })
const userButton = (page: Page) => page.locator('.side button[aria-haspopup="menu"]').last()

async function openTeamMenu(page: Page) {
  await brand(page).click()
  await expect(teamMenu(page)).toBeVisible()
}

async function pickTeam(page: Page, name: string) {
  await openTeamMenu(page)
  await teamMenu(page).getByRole('menuitemradio', { name: new RegExp(`^${name}`) }).first().click()
  await expect(teamMenu(page)).toHaveCount(0)
}

const teamsOf = (page: Page, email: string) => apiAs<Team[]>(page, email, '/teams')

/** Новая команда через меню и окно; после создания человек уже в ней */
async function createTeamInUi(page: Page, name: string) {
  await openTeamMenu(page)
  await teamMenu(page).getByRole('menuitem', { name: 'Создать команду' }).click()
  const dialog = page.getByRole('dialog', { name: 'Новая команда' })
  await dialog.getByLabel('Название').fill(name)
  await dialog.getByRole('button', { name: 'Создать' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(caption(page)).toHaveText(name)
}

async function openTeamContext(page: Page, item: string) {
  await brand(page).click({ button: 'right' })
  await page.getByRole('menuitem', { name: item }).click()
}

// ===== Переключатель =====

test.describe('переключатель команды', () => {
  test('в покое подпись как в макете, при наведении появляется ▾, меню открывается и закрывается по Esc', async ({ page }) => {
    await openApp(page)
    await expect(caption(page)).toHaveText(DEMO_TEAM)
    const chev = brand(page).locator('.chev')
    await page.mouse.move(700, 450)
    await expect(chev).toHaveCSS('opacity', '0')
    await brand(page).hover()
    await expect(chev).toHaveCSS('opacity', '1')

    await openTeamMenu(page)
    await expect(brand(page)).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(teamMenu(page)).toHaveCount(0)
  })

  test('меню: «Личное» первой, у текущей команды отметка, ниже «Создать команду» и (администратору сервера) «Все команды сервера»', async ({ page }) => {
    await openApp(page)
    await openTeamMenu(page)
    const items = teamMenu(page).getByRole('menuitemradio')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toContainText('Личное')
    await expect(items.nth(0)).toHaveAttribute('aria-checked', 'false')
    await expect(items.nth(1)).toContainText(DEMO_TEAM)
    await expect(items.nth(1)).toHaveAttribute('aria-checked', 'true')
    await expect(teamMenu(page).getByRole('menuitem', { name: 'Создать команду' })).toBeVisible()
    await expect(teamMenu(page).getByRole('menuitem', { name: 'Все команды сервера' })).toBeVisible()
  })

  test('обычному человеку «Все команды сервера» не предлагается', async ({ page }) => {
    await openApp(page, { email: ARTEM })
    await openTeamMenu(page)
    await expect(teamMenu(page).getByRole('menuitem', { name: 'Создать команду' })).toBeVisible()
    await expect(teamMenu(page).getByRole('menuitem', { name: 'Все команды сервера' })).toHaveCount(0)
  })

  test('выбор команды меняет подпись, проекты и вики; выбор запоминается', async ({ page }) => {
    await openApp(page)
    await expect(nav(page).getByRole('button')).toHaveCount(3)
    await pickTeam(page, 'Личное')
    await expect(caption(page)).toHaveText('Личное')
    await expect(nav(page).getByRole('button')).toHaveCount(0)
    await expect(page.getByText('У вас пока нет проектов')).toBeVisible()
    // вики у «Личного» своя и пустая
    await page.getByRole('button', { name: 'Вики' }).click()
    await expect(page.locator('.doc-main')).toContainText('Страниц нет. Создай первую кнопкой слева')

    await page.reload()
    await expect(caption(page)).toHaveText('Личное')
    await pickTeam(page, DEMO_TEAM)
    await expect(nav(page).getByRole('button')).toHaveCount(3)
    await page.reload()
    await expect(caption(page)).toHaveText(DEMO_TEAM)
  })

  test('снимок: меню команд в обеих темах', async ({ page }) => {
    for (const theme of ['light', 'dark'] as const) {
      await openApp(page, { theme })
      await openTeamMenu(page)
      await expect(page.locator('.side')).toHaveScreenshot(`switcher-menu-${theme}.png`)
    }
  })
})

// ===== Новая команда и настройки =====

test.describe('своя команда', () => {
  test('«Создать команду»: человек сразу в ней, он её администратор, проектов пока нет', async ({ page }) => {
    await openApp(page)
    await createTeamInUi(page, 'Веб-студия')
    await expect(nav(page).getByRole('button')).toHaveCount(0)
    const teams = await teamsOf(page, LENA)
    expect(teams.map((t) => [t.name, t.role])).toEqual([
      ['Личное', 'admin'],
      [DEMO_TEAM, 'admin'],
      ['Веб-студия', 'admin'],
    ])
    // и проект создаётся уже в ней, с видимостью «Только участники» по умолчанию
    await page.locator('.proj-head').hover()
    await page.getByRole('button', { name: 'Новый проект' }).click()
    const dialog = page.getByRole('dialog', { name: 'Новый проект' })
    await expect(dialog.getByText('Команда', { exact: true })).toBeVisible()
    await expect(dialog.locator('.f-val', { hasText: 'Веб-студия' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Только участники' })).toHaveAttribute('aria-pressed', 'true')
    await dialog.getByLabel('Название').fill('Сайт студии')
    await dialog.getByRole('button', { name: 'Вся команда' }).click()
    await dialog.getByRole('button', { name: 'Создать' }).click()
    await expect(nav(page).getByRole('button', { name: 'Сайт студии' })).toBeVisible()
    const projects = await apiAs<Array<{ name: string; team_id: string; visibility: string }>>(page, LENA, '/projects')
    const created = projects.find((p) => p.name === 'Сайт студии')!
    expect(created.team_id).toBe(teams[2].id)
    expect(created.visibility).toBe('team')
  })

  test('название команды: пустое не сохранить, лишнее отрезается, ошибки сервера на месте', async ({ page }) => {
    await openApp(page)
    await openTeamMenu(page)
    await teamMenu(page).getByRole('menuitem', { name: 'Создать команду' }).click()
    const dialog = page.getByRole('dialog', { name: 'Новая команда' })
    await expect(dialog.getByRole('button', { name: 'Создать' })).toBeDisabled()
    await dialog.getByLabel('Название').fill('  ')
    await expect(dialog.getByRole('button', { name: 'Создать' })).toBeDisabled()
    await expect(dialog.getByLabel('Название')).toHaveAttribute('maxlength', '60')
  })

  test('лимит пяти команд: на шестой окно отвечает текстом сервера', async ({ page }) => {
    await openApp(page)
    // демо-команду сид создал от имени Лены: она уже одна из пяти
    for (let i = 1; i <= 4; i++) await apiAs(page, LENA, '/teams', { method: 'POST', data: { name: `Команда ${i}` } })
    await openTeamMenu(page)
    await teamMenu(page).getByRole('menuitem', { name: 'Создать команду' }).click()
    const dialog = page.getByRole('dialog', { name: 'Новая команда' })
    await dialog.getByLabel('Название').fill('Шестая')
    await dialog.getByRole('button', { name: 'Создать' }).click()
    await expect(dialog.getByRole('alert')).toContainText('не больше 5')
    await expect(dialog).toBeVisible()
  })

  test('настройки команды: название, переключатель для гостей, три вкладки (у «Личного» две)', async ({ page }) => {
    await openApp(page)
    await openTeamContext(page, 'Настройки команды')
    const dialog = page.getByRole('dialog', { name: /^Настройки команды «/ })
    await expect(dialog.getByRole('tab')).toHaveText(['Основное', 'Участники', 'Архив'])
    await dialog.getByLabel('Название').fill('Общая команда')
    await dialog.getByRole('button', { name: 'Сохранить' }).click()
    await expect(dialog.getByRole('status')).toHaveText('Сохранено')
    await expect(caption(page)).toHaveText('Общая команда')

    const guests = dialog.getByRole('switch', { name: 'Гости проектов могут читать вики команды' })
    await expect(guests).toHaveAttribute('aria-checked', 'false')
    await guests.click()
    await expect(guests).toHaveAttribute('aria-checked', 'true')
    await expect.poll(async () => (await teamsOf(page, LENA)).find((t) => t.name === 'Общая команда')?.guests_read_wiki).toBe(true)
    await page.keyboard.press('Escape')

    await pickTeam(page, 'Личное')
    await openTeamContext(page, 'Настройки команды')
    const own = page.getByRole('dialog', { name: /^Настройки команды «/ })
    await expect(own.getByRole('tab')).toHaveText(['Основное', 'Участники'])
  })

  test('снимки: новая команда и настройки команды в обеих темах', async ({ page }) => {
    for (const theme of ['light', 'dark'] as const) {
      await openApp(page, { theme })
      await openTeamMenu(page)
      await teamMenu(page).getByRole('menuitem', { name: 'Создать команду' }).click()
      const created = page.getByRole('dialog', { name: 'Новая команда' })
      await expect(created).toHaveScreenshot(`new-team-${theme}.png`)
      await page.keyboard.press('Escape')
      await openTeamContext(page, 'Настройки команды')
      const settings = page.getByRole('dialog', { name: /^Настройки команды «/ })
      await expect(settings).toHaveScreenshot(`team-main-${theme}.png`)
      await settings.getByRole('tab', { name: 'Участники' }).click()
      await expect(settings.getByText('Администраторы команды видят все её проекты')).toBeVisible()
      await expect(settings).toHaveScreenshot(`team-members-${theme}.png`)
      await page.keyboard.press('Escape')
    }
  })
})

// ===== Состав и приглашения =====

test.describe('приглашения в команду', () => {
  test('администратор зовёт по e-mail, приглашённый принимает в «Приглашениях», обе стороны видят изменение сразу', async ({ page, browser }) => {
    await openApp(page)
    await createTeamInUi(page, 'Веб')
    const guest = await secondClient(browser, ARTEM)
    try {
      await openTeamContext(page, 'Настройки команды')
      const dialog = page.getByRole('dialog', { name: /^Настройки команды «/ })
      await dialog.getByRole('tab', { name: 'Участники' }).click()
      await dialog.getByLabel('E-mail').fill('nobody@example.com')
      await dialog.getByRole('button', { name: 'Пригласить', exact: true }).click()
      await expect(dialog.getByRole('alert')).toHaveText('Аккаунта с таким адресом нет')
      await dialog.getByLabel('E-mail').fill(ARTEM)
      await dialog.getByRole('button', { name: 'Пригласить', exact: true }).click()
      await expect(dialog.getByRole('status')).toContainText(`Приглашение отправлено: ${ARTEM}`)
      await expect(dialog.getByRole('group', { name: 'Приглашения в команду, на которые ещё не ответили' }).or(dialog.locator('.proj-rows[aria-label^="Приглашения в команду"]'))).toContainText('ожидает ответа')

      // у Артёма сразу счётчик и точка у имени; приглашение в разделе «Команды»
      await expect(guest.page.locator('.invite-dot')).toBeVisible()
      await guest.page.locator('.side button[aria-haspopup="menu"]').last().click()
      await guest.page.getByRole('menuitem', { name: /^Приглашения/ }).click()
      const invites = guest.page.getByRole('dialog', { name: 'Приглашения' })
      await expect(invites.getByRole('heading', { name: 'Команды' })).toBeVisible()
      await expect(invites.locator('.proj-row', { hasText: 'Веб' })).toContainText('Пригласил(а) Лена М.')
      await invites.locator('.proj-row', { hasText: 'Веб' }).getByRole('button', { name: 'Принять' }).click()
      await expect(invites.getByText('Приглашений нет')).toBeVisible()

      // команда появилась в его переключателе, а в составе у Лены он стал участником
      await guest.page.keyboard.press('Escape')
      await brand(guest.page).click()
      await expect(teamMenu(guest.page).getByRole('menuitemradio', { name: /^Веб/ })).toBeVisible()
      await expect(dialog.locator('.proj-rows[aria-label="Участники команды"]')).toContainText('Артём К.')
    } finally {
      await guest.close()
    }
  })

  test('приглашение можно отозвать, а отклонённое ничего не даёт', async ({ page, browser }) => {
    await openApp(page)
    await createTeamInUi(page, 'Веб')
    const team = (await teamsOf(page, LENA)).find((t) => t.name === 'Веб')!
    const invite = await apiAs<{ id: string }>(page, LENA, `/teams/${team.id}/invites`, { method: 'POST', data: { email: ARTEM } })
    await openTeamContext(page, 'Настройки команды')
    const dialog = page.getByRole('dialog', { name: /^Настройки команды «/ })
    await dialog.getByRole('tab', { name: 'Участники' }).click()
    await dialog.getByRole('button', { name: 'Отозвать' }).click()
    await expect(dialog.getByText('Ожидают ответа')).toHaveCount(0)
    expect(await apiAs<unknown[]>(page, ARTEM, '/team-invites')).toEqual([])

    const second = await apiAs<{ id: string }>(page, LENA, `/teams/${team.id}/invites`, { method: 'POST', data: { email: ARTEM } })
    expect(invite.id).not.toBe(second.id)
    const guest = await secondClient(browser, ARTEM)
    try {
      await guest.page.locator('.side button[aria-haspopup="menu"]').last().click()
      await guest.page.getByRole('menuitem', { name: /^Приглашения/ }).click()
      const invites = guest.page.getByRole('dialog', { name: 'Приглашения' })
      await invites.getByRole('button', { name: 'Отклонить' }).click()
      await expect(invites.getByText('Приглашений нет')).toBeVisible()
      expect((await teamsOf(page, ARTEM)).map((t) => t.name)).toEqual(['Личное', DEMO_TEAM])
    } finally {
      await guest.close()
    }
  })

  test('роль меняется, члена можно убрать; единственного администратора убрать нельзя, ошибка стоит на месте', async ({ page }) => {
    await openApp(page)
    await createTeamInUi(page, 'Веб')
    const team = (await teamsOf(page, LENA)).find((t) => t.name === 'Веб')!
    const invite = await apiAs<{ id: string }>(page, LENA, `/teams/${team.id}/invites`, { method: 'POST', data: { email: ARTEM } })
    await apiAs(page, ARTEM, `/team-invites/${invite.id}/accept`, { method: 'POST', data: {} })

    await openTeamContext(page, 'Настройки команды')
    const dialog = page.getByRole('dialog', { name: /^Настройки команды «/ })
    await dialog.getByRole('tab', { name: 'Участники' }).click()
    const row = dialog.locator('.proj-row', { hasText: 'Артём К.' })
    await row.getByRole('group', { name: 'Роль: Артём К.' }).getByRole('button', { name: 'Администратор' }).click()
    await expect.poll(async () => (await teamsOf(page, ARTEM)).find((t) => t.name === 'Веб')?.role).toBe('admin')
    // у себя роли и «Убрать» нет
    const mine = dialog.locator('.proj-row', { hasText: '(вы)' })
    await expect(mine.getByRole('button', { name: 'Убрать' })).toHaveCount(0)
    // убрать другого: вторым нажатием
    await row.getByRole('button', { name: 'Убрать' }).click()
    await row.getByRole('button', { name: 'Точно убрать?' }).click()
    await expect(dialog.locator('.proj-row', { hasText: 'Артём К.' })).toHaveCount(0)
    expect((await teamsOf(page, ARTEM)).map((t) => t.name)).toEqual(['Личное', DEMO_TEAM])
  })
})

// ===== Меню команды и выход =====

test.describe('меню команды по правой кнопке', () => {
  test('администратору: «Настройки команды», «Участники», «Выйти из команды»; из своего «Личного» выйти нельзя', async ({ page }) => {
    await openApp(page)
    await brand(page).click({ button: 'right' })
    const menu = page.getByRole('menu', { name: /^Команда «/ })
    await expect(menu.getByRole('menuitem')).toHaveText(['Настройки команды', 'Участники', 'Выйти из команды'])
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    await pickTeam(page, 'Личное')
    await brand(page).click({ button: 'right' })
    await expect(menu.getByRole('menuitem')).toHaveText(['Настройки команды', 'Участники'])
  })

  test('рядовой член видит «Участники» (только список) и «Выйти»; выход вторым нажатием, после него «Личное»', async ({ page }) => {
    await openApp(page, { email: ARTEM })
    await brand(page).click({ button: 'right' })
    const menu = page.getByRole('menu', { name: /^Команда «/ })
    await expect(menu.getByRole('menuitem')).toHaveText(['Участники', 'Выйти из команды'])
    await menu.getByRole('menuitem', { name: 'Участники' }).click()
    const list = page.getByRole('dialog', { name: /^Участники: / })
    await expect(list.locator('.proj-row')).toHaveCount(5)
    await expect(list.getByRole('button')).toHaveCount(1) // только «Закрыть»
    await page.keyboard.press('Escape')

    await brand(page).click({ button: 'right' })
    await menu.getByRole('menuitem', { name: 'Выйти из команды' }).click()
    await menu.getByRole('menuitem', { name: 'Точно выйти?' }).click()
    await expect(caption(page)).toHaveText('Личное')
    expect((await teamsOf(page, ARTEM)).map((t) => t.name)).toEqual(['Личное'])
  })
})

// ===== Гость =====

test.describe('гостевая команда', () => {
  async function inviteGuest(page: Page) {
    const lena = (await teamsOf(page, LENA)).find((t) => t.personal)!
    const project = await apiAs<{ id: string }>(page, LENA, '/projects', { method: 'POST', data: { team_id: lena.id, name: 'Проект гостя' } })
    const invite = await apiAs<{ id: string }>(page, LENA, `/projects/${project.id}/invites`, { method: 'POST', data: { email: IGOR } })
    await apiAs(page, IGOR, `/invites/${invite.id}/accept`, { method: 'POST', data: {} })
    return { team: lena, project }
  }

  test('в переключателе «Личное · гость», в ней нет «+» и «Вики», правая кнопка меню не открывает', async ({ page, browser }) => {
    await openApp(page)
    await inviteGuest(page)
    const igor = await secondClient(browser, IGOR, 'light', { team: null })
    const g = igor.page
    try {
      await openTeamMenu(g)
      const guestItem = teamMenu(g).getByRole('menuitemradio').filter({ hasText: 'гость' })
      await expect(guestItem).toHaveCount(1)
      await guestItem.click()
      await expect(caption(g)).toHaveText('Личное · гость')
      await expect(nav(g).getByRole('button', { name: 'Проект гостя' })).toBeVisible()
      await g.locator('.proj-head').hover()
      await expect(g.getByRole('button', { name: 'Новый проект' })).toHaveCount(0)
      await expect(g.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Вики' })).toHaveCount(0)
      await brand(g).click({ button: 'right' })
      await expect(g.getByRole('menu', { name: /^Команда «/ })).toHaveCount(0)
      // проект гостя работает как обычно
      await expect(g.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Доска' })).toBeVisible()
      await expect(brand(g)).toHaveScreenshot('guest-brand-light.png')
    } finally {
      await igor.close()
    }
  })

  test('когда администратор разрешил гостям читать вики, пункт «Вики» появляется сразу', async ({ page, browser }) => {
    await openApp(page)
    const { team } = await inviteGuest(page)
    const guest = await secondClient(browser, IGOR, 'light', { team: team.id })
    try {
      const wikiNav = guest.page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Вики' })
      await expect(wikiNav).toHaveCount(0)
      await apiAs(page, LENA, `/teams/${team.id}`, { method: 'PATCH', data: { guests_read_wiki: true } })
      await expect(wikiNav).toBeVisible()
      await apiAs(page, LENA, `/teams/${team.id}`, { method: 'PATCH', data: { guests_read_wiki: false } })
      await expect(wikiNav).toHaveCount(0)
    } finally {
      await guest.close()
    }
  })
})

// ===== Видимость проекта =====

test.describe('видимость проекта', () => {
  async function openSettings(page: Page, name: string) {
    await nav(page).getByRole('button', { name }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Настройки проекта' }).click()
    return page.getByRole('dialog', { name: /^Настройки проекта «/ })
  }

  test('«Вся команда» открывает проект членам команды; перед сменой окно с числом людей', async ({ page, browser }) => {
    await openApp(page)
    const team = await dreamTeamAs(page, LENA)
    const project = await apiAs<{ id: string }>(page, LENA, '/projects', { method: 'POST', data: { team_id: team, name: 'Закрытый для всех' } })
    const artem = await secondClient(browser, ARTEM)
    try {
      await expect(nav(artem.page).getByRole('button', { name: 'Закрытый для всех' })).toHaveCount(0)

      await page.reload()
      const dialog = await openSettings(page, 'Закрытый для всех')
      await expect(dialog.getByRole('button', { name: 'Только участники' })).toHaveAttribute('aria-pressed', 'true')
      await dialog.getByRole('button', { name: 'Вся команда' }).click()
      const ask = page.getByRole('dialog', { name: /^Проект увидят 4 члена команды$|^Проект увидят 4 членов команды$/ })
      await expect(ask).toBeVisible()
      await ask.getByRole('button', { name: 'Отмена' }).click()
      expect((await apiAs<Array<{ id: string; visibility: string }>>(page, LENA, '/projects')).find((p) => p.id === project.id)?.visibility).toBe('members')

      await dialog.getByRole('button', { name: 'Вся команда' }).click()
      await ask.getByRole('button', { name: 'Продолжить' }).click()
      await expect(dialog.getByRole('button', { name: 'Вся команда' })).toHaveAttribute('aria-pressed', 'true')
      // Артём видит проект сразу, без перезапуска
      await expect(nav(artem.page).getByRole('button', { name: 'Закрытый для всех' })).toBeVisible()

      // обратно: доступ потеряют те, кого нет в списке
      await dialog.getByRole('button', { name: 'Только участники' }).click()
      const back = page.getByRole('dialog', { name: /^Доступ потеряют \d+ человек/ })
      await expect(back).toBeVisible()
      await back.getByRole('button', { name: 'Продолжить' }).click()
      await expect(nav(artem.page).getByRole('button', { name: 'Закрытый для всех' })).toHaveCount(0)
    } finally {
      await artem.close()
    }
  })

  test('в составе проекта «Вся команда»: администраторы команды и все члены, «Убрать» у неявных неактивна, повышение без приглашения', async ({ page }) => {
    await openApp(page)
    const team = await dreamTeamAs(page, LENA)
    const project = await apiAs<{ id: string }>(page, LENA, '/projects', {
      method: 'POST',
      data: { team_id: team, name: 'Для всех', visibility: 'team' },
    })
    await page.reload()
    const dialog = await openSettings(page, 'Для всех')
    await dialog.getByRole('tab', { name: 'Участники' }).click()
    const rows = dialog.locator('.proj-rows[aria-label="Участники проекта"] .proj-row')
    await expect(rows).toHaveCount(5)
    const igor = rows.filter({ hasText: 'Игорь П.' })
    await expect(igor).toContainText('Член команды')
    const remove = igor.getByRole('button', { name: /^Убрать/ })
    await expect(remove).toBeDisabled()
    await expect(remove).toHaveAttribute('title', /Доступ у всей команды/)

    await igor.getByRole('group', { name: 'Роль: Игорь П.' }).getByRole('button', { name: 'Администратор' }).click()
    await expect.poll(async () => {
      const members = await apiAs<{ members: Array<{ name: string; implicit: boolean; role: string }> }>(page, LENA, `/projects/${project.id}/members`)
      return members.members.find((m) => m.name === 'Игорь П.')
    }).toMatchObject({ implicit: false, role: 'admin' })
    await expect(igor.getByRole('button', { name: 'Убрать', exact: true })).toBeEnabled()
  })

  test('«Выйти из проекта» есть у участника, который теряет доступ, и нет у администратора команды', async ({ page }) => {
    await openApp(page, { email: ARTEM })
    const team = await dreamTeamAs(page, ARTEM)
    const project = await apiAs<{ id: string }>(page, ARTEM, '/projects', { method: 'POST', data: { team_id: team, name: 'Мой проект' } })
    await apiAs(page, ARTEM, `/projects/${project.id}`, { method: 'PATCH', data: { visibility: 'members' } })
    await page.reload()
    await nav(page).getByRole('button', { name: 'Мой проект' }).click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Проект «Мой проект»' })
    await expect(menu.getByRole('menuitem', { name: 'Выйти из проекта' })).toBeVisible()
    await page.keyboard.press('Escape')

    await apiAs(page, ARTEM, `/projects/${project.id}`, { method: 'PATCH', data: { visibility: 'team' } })
    await page.reload()
    await nav(page).getByRole('button', { name: 'Мой проект' }).click({ button: 'right' })
    await expect(menu.getByRole('menuitem', { name: 'Выйти из проекта' })).toHaveCount(0)
  })
})

// ===== Архив =====

test.describe('архив команд', () => {
  test('архивированная команда исчезает, окно «Архив проектов» возвращает её в разделе «Команды»', async ({ page }) => {
    await openApp(page)
    await createTeamInUi(page, 'Веб')
    await openTeamContext(page, 'Настройки команды')
    const dialog = page.getByRole('dialog', { name: /^Настройки команды «/ })
    await dialog.getByRole('tab', { name: 'Архив' }).click()
    await dialog.getByRole('button', { name: 'Архивировать' }).click()
    await dialog.getByRole('button', { name: 'Точно архивировать?' }).click()
    await expect(dialog).toHaveCount(0)
    // выбранной команды больше нет: на экране «Личное»
    await expect(caption(page)).toHaveText('Личное')
    await openTeamMenu(page)
    await expect(teamMenu(page).getByRole('menuitemradio', { name: /^Веб/ })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await userButton(page).click()
    await page.getByRole('menuitem', { name: 'Архив проектов' }).click()
    const archive = page.getByRole('dialog', { name: 'Архив проектов' })
    await expect(archive.getByRole('heading', { name: 'Команды' })).toBeVisible()
    await expect(archive).toHaveScreenshot('team-archive-light.png')
    await archive.getByRole('button', { name: 'Вернуть' }).click()
    await expect(archive.getByText('Архив пуст')).toBeVisible()
    await page.keyboard.press('Escape')
    await openTeamMenu(page)
    await expect(teamMenu(page).getByRole('menuitemradio', { name: /^Веб/ })).toBeVisible()
  })

  test('в «Личном» вкладки «Архив» нет', async ({ page }) => {
    await openApp(page)
    await pickTeam(page, 'Личное')
    await openTeamContext(page, 'Настройки команды')
    await expect(page.getByRole('dialog', { name: /^Настройки команды «/ }).getByRole('tab', { name: 'Архив' })).toHaveCount(0)
  })
})

// ===== Администратор сервера =====

test.describe('все команды сервера', () => {
  test('поиск по названию и по владельцу «Личного», «Открыть» переходит в чужую команду', async ({ page }) => {
    await openApp(page)
    await apiAs(page, ARTEM, '/teams', { method: 'POST', data: { name: 'Чужая студия' } })
    await openTeamMenu(page)
    await teamMenu(page).getByRole('menuitem', { name: 'Все команды сервера' }).click()
    const dialog = page.getByRole('dialog', { name: 'Все команды сервера' })
    await expect(dialog.locator('.proj-row').first()).toContainText(DEMO_TEAM)
    await dialog.getByLabel('Найти команду').fill('студ')
    await expect(dialog.locator('.proj-row')).toHaveCount(1)
    await expect(dialog.locator('.proj-row')).toContainText('Чужая студия')
    await dialog.getByLabel('Найти команду').fill('артём')
    await expect(dialog.locator('.proj-row')).toContainText('Личное · Артём К.')
    await dialog.getByLabel('Найти команду').fill('студ')
    await dialog.getByRole('button', { name: 'Открыть' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(caption(page)).toHaveText('Чужая студия')
    // чужая команда в меню помечена, и Лена в ней может настроить и сменить название
    await openTeamMenu(page)
    await expect(teamMenu(page).getByRole('menuitemradio', { name: /^Чужая студия/ })).toContainText('не ваша')
  })

  test('обычному человеку этого окна нет', async ({ page }) => {
    await openApp(page, { email: ARTEM })
    expect(await apiAs<unknown>(page, ARTEM, '/teams').then(() => true)).toBe(true)
    await openTeamMenu(page)
    await expect(teamMenu(page).getByRole('menuitem', { name: 'Все команды сервера' })).toHaveCount(0)
  })
})
