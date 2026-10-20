import { describe, expect, it } from 'vitest'
import type { LinkGroup, LinkItem } from '../../lib/api/types'
import { addGroup, addLink, hostOf, normalizeUrl, removeGroup, removeLink, renameGroup } from './logic'

const link = (id: string, group_id: string, title = id): LinkItem => ({ id, group_id, title, url: `https://example.com/${id}`, description: '' })
const group = (id: string, links: LinkItem[] = []): LinkGroup => ({ id, title: `Группа ${id}`, links })

describe('normalizeUrl', () => {
  it('без схемы добавляется https://, пробелы по краям убираются', () => {
    expect(normalizeUrl('example.com/repo')).toBe('https://example.com/repo')
    expect(normalizeUrl('  example.com  ')).toBe('https://example.com')
  })

  it('http и https остаются, регистр схемы не важен', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com')
    expect(normalizeUrl('HTTPS://Example.com')).toBe('HTTPS://Example.com')
  })

  it('пустой адрес — null', () => {
    expect(normalizeUrl('')).toBeNull()
    expect(normalizeUrl('   ')).toBeNull()
  })
})

describe('hostOf', () => {
  it('убирает схему', () => {
    expect(hostOf('https://example.com/git/api')).toBe('example.com/git/api')
    expect(hostOf('http://example.com')).toBe('example.com')
    expect(hostOf('HTTPS://example.com')).toBe('example.com')
  })
})

describe('правки списка групп', () => {
  const list = [group('g1', [link('k1', 'g1'), link('k2', 'g1')]), group('g2', [link('k3', 'g2')])]

  it('addGroup кладёт группу в конец и не дублирует', () => {
    expect(addGroup(list, group('g3')).map((g) => g.id)).toEqual(['g1', 'g2', 'g3'])
    expect(addGroup(list, group('g1')).map((g) => g.id)).toEqual(['g2', 'g1'])
  })

  it('renameGroup меняет только название нужной группы', () => {
    const next = renameGroup(list, 'g2', 'Новое')
    expect(next.map((g) => g.title)).toEqual(['Группа g1', 'Новое'])
    expect(next[0]).toBe(list[0])
  })

  it('removeGroup убирает группу вместе со ссылками', () => {
    expect(removeGroup(list, 'g1').map((g) => g.id)).toEqual(['g2'])
  })

  it('addLink кладёт ссылку в конец своей группы и не дублирует', () => {
    const next = addLink(list, link('k4', 'g2'))
    expect(next[1]!.links.map((l) => l.id)).toEqual(['k3', 'k4'])
    expect(next[0]).toBe(list[0])
    expect(addLink(list, link('k1', 'g1', 'Заменённая'))[0]!.links.map((l) => l.title)).toEqual(['k2', 'Заменённая'])
  })

  it('addLink для группы, которой нет, ничего не меняет', () => {
    expect(addLink(list, link('k9', 'нет'))).toEqual(list)
  })

  it('removeLink убирает ссылку из своей группы, остальные группы не трогает', () => {
    const next = removeLink(list, 'k2')
    expect(next[0]!.links.map((l) => l.id)).toEqual(['k1'])
    expect(next[1]).toBe(list[1])
    expect(removeLink(list, 'нет')).toEqual(list)
  })
})
