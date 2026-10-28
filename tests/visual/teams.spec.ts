// Команды (этап К1, docs/TEAMS.md): вики, файлы и поиск идут по команде. Интерфейса команд пока нет, поэтому проверяется то,
// что человек видит в обычных экранах: у кого какая вики и как ведёт себя гость чужой команды.

import { expect, test } from '@playwright/test'
import { openApp, resetData } from './fixtures'
import { apiAs, statusAs } from './projects-helpers'
import { editor } from './wiki-helpers'

test.beforeEach(() => resetData())

const LENA = 'lena@example.com'
const ARTEM = 'artem@example.com'

type Team = { id: string; name: string; personal: boolean; role: string | null; guest: boolean; wiki: boolean }
type Node = { id: string; title: string }

test('у каждого человека есть «Личное», а общая вики демо-данных лежит в «Dream Team»', async ({ page }) => {
  const teams = await apiAs<Team[]>(page, ARTEM, '/teams')
  expect(teams.map((t) => [t.name, t.personal, t.role])).toEqual([
    ['Личное', true, 'admin'],
    ['Dream Team', false, 'member'],
  ])
  const dream = teams[1]
  expect((await apiAs<Node[]>(page, ARTEM, `/teams/${dream.id}/wiki`)).length).toBe(7)
  expect(await apiAs<Node[]>(page, ARTEM, `/teams/${teams[0].id}/wiki`)).toEqual([])
})

test('гость проекта из чужого «Личного» работает с вики своей команды, а чужую вики не видит', async ({ page }) => {
  // у Лены закрытый проект в её «Личном», в него приглашён Артём
  const lenaPersonal = (await apiAs<Team[]>(page, LENA, '/teams')).find((t) => t.personal)!
  const project = await apiAs<{ id: string }>(page, LENA, '/projects', {
    method: 'POST',
    data: { team_id: lenaPersonal.id, name: 'Проект гостя' },
  })
  await apiAs(page, LENA, `/teams/${lenaPersonal.id}/wiki`, { method: 'POST', data: { title: 'Личная страница Лены' } })
  const invite = await apiAs<{ id: string }>(page, LENA, `/projects/${project.id}/invites`, { method: 'POST', data: { email: ARTEM } })
  await apiAs(page, ARTEM, `/invites/${invite.id}/accept`, { method: 'POST', data: {} })

  // Артём видит её команду как гостевую, без вики
  const teams = await apiAs<Team[]>(page, ARTEM, '/teams')
  const guestTeam = teams.find((t) => t.id === lenaPersonal.id)!
  expect({ guest: guestTeam.guest, role: guestTeam.role, wiki: guestTeam.wiki }).toEqual({ guest: true, role: null, wiki: false })

  // открыл проект гостя и зашёл в вики: она его собственная, а не Ленина
  await openApp(page, { email: ARTEM, settings: { project: project.id, page: 'wiki' } })
  await expect(page.locator('.doc-main')).toContainText('Страниц нет. Создай первую кнопкой слева')
  await page.getByRole('button', { name: 'Новая страница' }).click()
  await expect(editor(page)).toBeFocused()

  const own = teams.find((t) => t.personal && t.role === 'admin')!
  expect((await apiAs<Node[]>(page, ARTEM, `/teams/${own.id}/wiki`)).length, 'страница легла в «Личное» Артёма').toBe(1)
  expect((await apiAs<Node[]>(page, LENA, `/teams/${lenaPersonal.id}/wiki`)).map((n) => n.title), 'вики Лены не тронута').toEqual([
    'Личная страница Лены',
  ])
})

test('гость не читает вики чужой команды, пока её администратор не разрешил (настройку включат ручки К2)', async ({ page }) => {
  const lenaPersonal = (await apiAs<Team[]>(page, LENA, '/teams')).find((t) => t.personal)!
  const project = await apiAs<{ id: string }>(page, LENA, '/projects', {
    method: 'POST',
    data: { team_id: lenaPersonal.id, name: 'Проект гостя' },
  })
  const invite = await apiAs<{ id: string }>(page, LENA, `/projects/${project.id}/invites`, { method: 'POST', data: { email: ARTEM } })
  await apiAs(page, ARTEM, `/invites/${invite.id}/accept`, { method: 'POST', data: {} })
  const created = await apiAs<Node>(page, LENA, `/teams/${lenaPersonal.id}/wiki`, { method: 'POST', data: { title: 'Для гостей', md: 'текст' } })

  // настройка по умолчанию выключена: вики для Артёма нет
  expect(await statusAs(page, ARTEM, `/teams/${lenaPersonal.id}/wiki`)).toBe(404)
  expect(await statusAs(page, ARTEM, `/wiki/${created.id}`)).toBe(404)
})
