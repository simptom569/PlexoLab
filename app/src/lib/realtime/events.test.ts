import { describe, expect, it } from 'vitest'
import { keys } from '../api/queries'
import { parseMessage, queryKeysFor, type ServerEvent } from './events'

const event = (type: string, extra: Partial<ServerEvent> = {}): ServerEvent => ({ type, id: null, project_id: null, origin: null, ...extra })

describe('parseMessage', () => {
  it('служебные сообщения', () => {
    expect(parseMessage('{"type":"ready"}')).toEqual({ kind: 'ready' })
    expect(parseMessage('{"type":"ping"}')).toEqual({ kind: 'ping' })
    expect(parseMessage('{"type":"resync"}')).toEqual({ kind: 'resync' })
    expect(parseMessage('{"type":"error","code":"unauthorized"}')).toEqual({ kind: 'error', code: 'unauthorized' })
    expect(parseMessage('{"type":"error"}')).toEqual({ kind: 'error', code: 'error' })
  })

  it('событие: тип, запись, проект и метка клиента', () => {
    expect(parseMessage('{"type":"task.created","id":null,"project_id":"p1","origin":"c1"}')).toEqual({
      kind: 'event',
      event: { type: 'task.created', id: null, project_id: 'p1', origin: 'c1' },
    })
    expect(parseMessage('{"type":"wiki.updated","id":"w1"}')).toEqual({
      kind: 'event',
      event: { type: 'wiki.updated', id: 'w1', project_id: null, origin: null },
    })
  })

  it('значения не тех типов считаются отсутствующими', () => {
    expect(parseMessage('{"type":"doc.updated","id":5,"project_id":false,"origin":{}}')).toEqual({
      kind: 'event',
      event: { type: 'doc.updated', id: null, project_id: null, origin: null },
    })
  })

  it('не JSON, не объект и объект без типа игнорируются', () => {
    for (const raw of ['', 'ready', '[]', '42', 'null', '"ready"', '{}', '{"type":5}', '{"type":""}', '{']) {
      expect(parseMessage(raw), raw).toBeNull()
    }
  })
})

describe('queryKeysFor', () => {
  it('задача: доска проекта (если проект известен) и сама задача', () => {
    expect(queryKeysFor(event('task.created', { project_id: 'p1' }))).toEqual([keys.board('p1'), ['task']])
    expect(queryKeysFor(event('task.updated', { id: 't1' }))).toEqual([['board'], keys.task('t1')])
    expect(queryKeysFor(event('task.deleted', { id: 't1' }))).toEqual([['board'], keys.task('t1')])
  })

  it('задача без id: все открытые задачи; переехавшие задачи: доска и все задачи', () => {
    expect(queryKeysFor(event('task.updated'))).toEqual([['board'], ['task']])
    expect(queryKeysFor(event('task.moved'))).toEqual([['board'], ['task']])
    expect(queryKeysFor(event('task.moved', { project_id: 'p1' }))).toEqual([keys.board('p1'), ['task']])
  })

  it('колонки, модули, вехи и метки приходят с доской', () => {
    for (const type of ['column.changed', 'module.changed', 'milestone.changed', 'tag.changed']) {
      expect(queryKeysFor(event(type, { project_id: 'p1' })), type).toEqual([keys.board('p1')])
      expect(queryKeysFor(event(type, { id: 'x' })), type).toEqual([['board']])
    }
  })

  it('комментарий: только задача', () => {
    expect(queryKeysFor(event('comment.created', { id: 't1' }))).toEqual([keys.task('t1')])
    expect(queryKeysFor(event('comment.created'))).toEqual([['task']])
  })

  it('релизы: своего проекта или все', () => {
    expect(queryKeysFor(event('release.changed', { project_id: 'p1' }))).toEqual([keys.releases('p1')])
    expect(queryKeysFor(event('release.changed', { id: 'r1' }))).toEqual([['releases']])
  })

  it('вики: дерево и страница', () => {
    expect(queryKeysFor(event('wiki.updated', { id: 'w1' }))).toEqual([keys.wiki, keys.wikiPage('w1')])
    expect(queryKeysFor(event('wiki.updated'))).toEqual([keys.wiki, ['wiki-page']])
  })

  it('документы: список (и поиск под ним) и документ; холст — только документ', () => {
    expect(queryKeysFor(event('doc.updated', { id: 'd1' }))).toEqual([keys.docs, keys.doc('d1')])
    expect(queryKeysFor(event('doc.updated'))).toEqual([keys.docs, ['doc']])
    expect(queryKeysFor(event('doc.canvas', { id: 'd1' }))).toEqual([keys.doc('d1')])
  })

  it('файлы: библиотека, папки и открытые задачи (вложения)', () => {
    expect(queryKeysFor(event('file.changed'))).toEqual([keys.files, keys.folders, ['task']])
  })

  it('ссылки и активность', () => {
    expect(queryKeysFor(event('link.changed', { id: 'g1' }))).toEqual([keys.linkGroups])
    expect(queryKeysFor(event('activity.created'))).toEqual([keys.activity])
  })

  it('незнакомое событие ничего не перечитывает', () => {
    expect(queryKeysFor(event('something.new'))).toEqual([])
  })

  it('ключи начинаются так же, как ключи запросов экранов: иначе перечитывать было бы нечего', () => {
    // поиск документов и вся лента лежат под общим началом ключа
    expect(keys.docSearch('x').slice(0, 1)).toEqual(keys.docs)
    expect(keys.activityFeed('u', 'doc').slice(0, 1)).toEqual(keys.activity)
    expect(keys.board('p1').slice(0, 1)).toEqual(['board'])
    expect(keys.task('t1').slice(0, 1)).toEqual(['task'])
    expect(keys.releases('p1').slice(0, 1)).toEqual(['releases'])
    expect(keys.wikiPage('w1').slice(0, 1)).toEqual(['wiki-page'])
    expect(keys.doc('d1').slice(0, 1)).toEqual(['doc'])
  })
})
