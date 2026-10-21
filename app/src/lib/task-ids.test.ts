import { describe, expect, it } from 'vitest'
import type { Board } from './api/types'
import {
  compareTaskKeys,
  idsChangeText,
  moduleKeyChangeCount,
  moduleKeyChangeDetail,
  projectKeyChangeCount,
  projectKeyChangeDetail,
  splitTaskKey,
} from './task-ids'

const board = (tasks: Array<{ module_id: string | null }>, modules: Array<{ id: string; key: string | null }>) =>
  ({ tasks, modules }) as unknown as Board

describe('splitTaskKey', () => {
  it('делит подпись и номер по последнему дефису', () => {
    expect(splitTaskKey('SEO-3')).toEqual({ prefix: 'SEO', number: 3 })
    expect(splitTaskKey('TASK-12')).toEqual({ prefix: 'TASK', number: 12 })
    expect(splitTaskKey('A-1-7')).toEqual({ prefix: 'A-1', number: 7 })
  })
})

describe('compareTaskKeys', () => {
  it('сначала по ключу, потом по номеру как по числу', () => {
    const keys = ['WEB-10', 'SEO-2', 'WEB-9', 'SEO-11', 'API-1', 'WEB2-1']
    expect(keys.slice().sort(compareTaskKeys)).toEqual(['API-1', 'SEO-2', 'SEO-11', 'WEB-9', 'WEB-10', 'WEB2-1'])
  })

  it('равные id равны', () => {
    expect(compareTaskKeys('WEB-1', 'WEB-1')).toBe(0)
  })
})

describe('idsChangeText', () => {
  it('склоняет «задачи»: у 1 задачи, у 3 задач, у 21 задачи, у 11 задач', () => {
    expect(idsChangeText(1)).toBe('У 1 задачи изменятся id')
    expect(idsChangeText(3)).toBe('У 3 задач изменятся id')
    expect(idsChangeText(11)).toBe('У 11 задач изменятся id')
    expect(idsChangeText(21)).toBe('У 21 задачи изменятся id')
  })
})

describe('сколько задач сменят id', () => {
  const b = board(
    [{ module_id: 'seo' }, { module_id: 'seo' }, { module_id: 'design' }, { module_id: null }, { module_id: 'plain' }],
    [
      { id: 'seo', key: 'SEO' },
      { id: 'design', key: null },
      { id: 'plain', key: null },
    ],
  )

  it('у модуля: все его задачи', () => {
    expect(moduleKeyChangeCount(b, 'seo')).toBe(2)
    expect(moduleKeyChangeCount(b, 'design')).toBe(1)
    expect(moduleKeyChangeCount(b, 'none')).toBe(0)
  })

  it('у проекта: задачи в ряду проекта, то есть без модуля и в модулях без ключа', () => {
    expect(projectKeyChangeCount(b)).toBe(3)
  })
})

describe('пояснения', () => {
  it('первый ключ, снятие и переименование описаны по-разному', () => {
    expect(moduleKeyChangeDetail(null, 'DSN', 'PLX')).toContain('DSN-1, DSN-2')
    expect(moduleKeyChangeDetail('SEO', null, 'PLX')).toContain('PLX-…')
    expect(moduleKeyChangeDetail('SEO', null, null)).toContain('TASK-…')
    expect(moduleKeyChangeDetail('SEO', 'MKT', 'PLX')).toBe('Номера останутся прежними, изменится только префикс: SEO-… станет MKT-…')
  })

  it('у проекта без ключа префикс TASK', () => {
    expect(projectKeyChangeDetail(null, 'PLX')).toBe('Номера останутся прежними, изменится только префикс: TASK-… станет PLX-…')
    expect(projectKeyChangeDetail('PLX', null)).toContain('станет TASK-…')
  })
})
