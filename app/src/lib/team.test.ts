import { describe, expect, it } from 'vitest'
import type { Team } from './api/types'
import { canCreateProject, canLeaveTeam, canManageTeam, pickTeam } from './team'

const team = (id: string, over: Partial<Team> = {}): Team => ({
  id,
  name: id,
  personal: false,
  owner: false,
  role: 'member',
  guest: false,
  wiki: true,
  archived: false,
  ...over,
})

const personal = team('personal', { personal: true, owner: true, role: 'admin' })
const web = team('web')
const guestClosed = team('closed', { role: null, guest: true, wiki: false })

describe('pickTeam', () => {
  it('пока команд нет, выбирать нечего', () => {
    expect(pickTeam(undefined, 'web', null)).toBeNull()
    expect(pickTeam([], 'web', null)).toBeNull()
  })

  it('выбранная команда берётся, если она ещё моя', () => {
    expect(pickTeam([personal, web], 'web', null)).toEqual(web)
  })

  it('выбранной больше нет (меня убрали, команду заархивировали): «Личное», она первая в списке', () => {
    expect(pickTeam([personal, web], 'ушла', null)).toEqual(personal)
  })

  it('команду ещё не выбирали: команда запомненного проекта, а без него «Личное»', () => {
    expect(pickTeam([personal, web], null, 'web')).toEqual(web)
    expect(pickTeam([personal, web], null, null)).toEqual(personal)
    expect(pickTeam([personal, web], null, 'чужая')).toEqual(personal)
  })

  it('выбранная команда сильнее запомненного проекта', () => {
    expect(pickTeam([personal, web], 'personal', 'web')).toEqual(personal)
  })

  it('гостевую команду выбрать можно', () => {
    expect(pickTeam([personal, guestClosed], 'closed', null)).toEqual(guestClosed)
  })
})

describe('права в команде', () => {
  it('управляет администратор команды и администратор сервера, но не рядовой член и не гость', () => {
    expect(canManageTeam(personal, false)).toBe(true)
    expect(canManageTeam(web, false)).toBe(false)
    expect(canManageTeam(guestClosed, false)).toBe(false)
    expect(canManageTeam(web, true)).toBe(true)
    expect(canManageTeam(null, true)).toBe(false)
  })

  it('проекты создаёт член команды, гость нет', () => {
    expect(canCreateProject(web)).toBe(true)
    expect(canCreateProject(guestClosed)).toBe(false)
    expect(canCreateProject(null)).toBe(false)
  })

  it('выйти можно из чужой команды, а из своего «Личного» нельзя; гостю выходить не откуда', () => {
    expect(canLeaveTeam(web)).toBe(true)
    expect(canLeaveTeam(personal)).toBe(false)
    expect(canLeaveTeam(team('чужое-личное', { personal: true, role: 'admin', owner: false }))).toBe(true)
    expect(canLeaveTeam(guestClosed)).toBe(false)
    expect(canLeaveTeam(null)).toBe(false)
  })
})
