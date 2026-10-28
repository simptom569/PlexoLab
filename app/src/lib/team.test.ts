import { describe, expect, it } from 'vitest'
import type { Team } from './api/types'
import { pickTeam, teamForNewProject } from './team'

const team = (id: string, over: Partial<Team> = {}): Team => ({
  id,
  name: id,
  personal: false,
  role: 'member',
  guest: false,
  wiki: true,
  archived: false,
  ...over,
})

describe('pickTeam', () => {
  const personal = team('personal', { personal: true, role: 'admin' })
  const web = team('web')
  const guestClosed = team('closed', { role: null, guest: true, wiki: false })
  const guestOpen = team('open', { role: null, guest: true, wiki: true })

  it('пока команд нет, выбирать нечего', () => {
    expect(pickTeam(undefined, 'web')).toBeNull()
    expect(pickTeam([], 'web')).toBeNull()
  })

  it('берётся команда открытого проекта', () => {
    expect(pickTeam([personal, web], 'web')).toBe('web')
  })

  it('если вики команды проекта не читать (гость без разрешения), берётся первая с доступной вики, то есть «Личное»', () => {
    expect(pickTeam([personal, web, guestClosed], 'closed')).toBe('personal')
  })

  it('гостевая команда с разрешением годится', () => {
    expect(pickTeam([personal, guestOpen], 'open')).toBe('open')
  })

  it('без проекта или с проектом чужой команды: первая с доступной вики', () => {
    expect(pickTeam([personal, web], null)).toBe('personal')
    expect(pickTeam([personal, web], 'нет такой')).toBe('personal')
  })
})

describe('teamForNewProject', () => {
  const personal = team('personal', { personal: true, role: 'admin' })
  const web = team('web')
  const guest = team('guest', { role: null, guest: true, wiki: false })

  it('проект создаётся в текущей команде, если я в ней член', () => {
    expect(teamForNewProject([personal, web], 'web')).toBe('web')
  })

  it('в гостевой команде создавать нельзя: берётся первая, где я член', () => {
    expect(teamForNewProject([personal, web, guest], 'guest')).toBe('personal')
    expect(teamForNewProject([personal, web], null)).toBe('personal')
  })

  it('команд нет: создавать негде', () => {
    expect(teamForNewProject(undefined, null)).toBeNull()
    expect(teamForNewProject([guest], 'guest')).toBeNull()
  })
})
