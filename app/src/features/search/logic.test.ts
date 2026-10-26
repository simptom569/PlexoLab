import { describe, expect, it } from 'vitest'
import type { SearchResult } from '../../lib/api/types'
import { emptyText, flatten, GROUPS, inGroup, moveActive, UNTITLED } from './logic'

const result: SearchResult = {
  tasks: [{ id: 't1', project_id: 'p1', project_name: 'Web-приложение', key: 'WEB-141', title: 'Тёмная тема' }],
  docs: [
    { id: 'd1', project_id: 'p1', project_name: 'Web-приложение', title: 'Планирование Q4', mode: 'page' },
    { id: 'd2', project_id: 'p2', project_name: 'Мобильный API', title: '  ', mode: 'edge' },
  ],
  wiki: [
    { id: 'w1', title: 'Архитектура' },
    { id: 'w2', title: '' },
  ],
  files: [{ id: 'f1', name: 'план-релиза.pdf', kind: 'pdf', size_bytes: 2048 }],
}

describe('flatten', () => {
  it('одним списком в порядке групп: задачи, документы, вики, файлы', () => {
    expect(flatten(result).map((i) => `${i.kind}:${i.id}`)).toEqual(['task:t1', 'doc:d1', 'doc:d2', 'wiki:w1', 'wiki:w2', 'file:f1'])
  })

  it('у задачи id для показа и проект, у документа проект, у вики и файла своё место', () => {
    const [task, doc, , wiki, , file] = flatten(result)
    expect(task).toMatchObject({ key: 'WEB-141', projectId: 'p1', where: 'Web-приложение', title: 'Тёмная тема', icon: 'board' })
    expect(doc).toMatchObject({ key: null, projectId: 'p1', where: 'Web-приложение', icon: 'docs' })
    expect(wiki).toMatchObject({ projectId: null, where: 'Вики', icon: 'wiki' })
    expect(file).toMatchObject({ projectId: null, title: 'план-релиза.pdf', where: 'Файлы · 2 КБ', icon: 'paperclip' })
  })

  it('без названия: «Без названия»', () => {
    const items = flatten(result)
    expect(items.find((i) => i.id === 'd2')!.title).toBe(UNTITLED)
    expect(items.find((i) => i.id === 'w2')!.title).toBe(UNTITLED)
  })

  it('пустой результат: пустой список', () => {
    expect(flatten({ tasks: [], docs: [], wiki: [], files: [] })).toEqual([])
  })
})

describe('inGroup', () => {
  it('строки группы с номерами в общем списке (по ним ставится выбор)', () => {
    const items = flatten(result)
    expect(inGroup(items, 'doc').map((r) => r.index)).toEqual([1, 2])
    expect(inGroup(items, 'file').map((r) => r.item.id)).toEqual(['f1'])
    expect(inGroup(items, 'task')).toHaveLength(1)
  })

  it('группы окна идут в порядке показа', () => {
    expect(GROUPS.map((g) => g.title)).toEqual(['Задачи', 'Документы', 'Вики', 'Файлы'])
  })
})

describe('moveActive', () => {
  it('вниз и вверх по кругу', () => {
    expect(moveActive(0, 1, 3)).toBe(1)
    expect(moveActive(2, 1, 3)).toBe(0)
    expect(moveActive(0, -1, 3)).toBe(2)
    expect(moveActive(1, -1, 3)).toBe(0)
  })

  it('пустой список: выбирать нечего', () => {
    expect(moveActive(0, 1, 0)).toBe(0)
    expect(moveActive(0, -1, 0)).toBe(0)
  })

  it('одна строка остаётся выбранной', () => {
    expect(moveActive(0, 1, 1)).toBe(0)
    expect(moveActive(0, -1, 1)).toBe(0)
  })
})

describe('emptyText', () => {
  it('подсказка, пока ничего не набрано', () => {
    expect(emptyText('', false)).toContain('Начните печатать')
    expect(emptyText('   ', true)).toContain('Начните печатать')
  })

  it('поиск идёт или ничего не нашлось', () => {
    expect(emptyText('экспорт', true)).toBe('Ищу…')
    expect(emptyText('экспорт', false)).toBe('Ничего не найдено')
  })
})
