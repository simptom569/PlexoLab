import { describe, expect, it } from 'vitest'
import { activityPath } from '../../lib/api/queries'
import type { ActivityEvent } from '../../lib/api/types'
import { ACT_KINDS } from '../../lib/settings'
import { effectiveWho, groupByDay, KIND_CHIPS, KIND_META, kindMeta } from './logic'

const event = (id: string, at: Date, category = 'tasks'): ActivityEvent => ({
  id,
  actor_id: 'u1',
  project_id: null,
  category,
  target: `Цель ${id}`,
  text: 'сделано',
  created_at: at.toISOString(),
})

describe('метки типов события', () => {
  it('подписи и цвета как в макете, плюс «Модуль»', () => {
    expect(KIND_META).toEqual({
      tasks: { label: 'Задача', tone: 1 },
      comment: { label: 'Комментарий', tone: 7 },
      code: { label: 'Код', tone: 5 },
      doc: { label: 'Документ', tone: 3 },
      release: { label: 'Релиз', tone: 6 },
      file: { label: 'Файл', tone: 2 },
      module: { label: 'Модуль', tone: 4 },
    })
  })

  it('незнакомая категория показывается как задача', () => {
    expect(kindMeta('whatever')).toEqual({ label: 'Задача', tone: 1 })
  })

  it('чипы фильтра совпадают со значениями настроек, «Все события» первый', () => {
    expect(KIND_CHIPS.map(([value]) => value)).toEqual([...ACT_KINDS])
    expect(KIND_CHIPS.map(([, label]) => label)).toEqual([
      'Все события',
      'Задачи',
      'Комментарии',
      'Код',
      'Документы',
      'Релизы',
      'Файлы',
      'Модули',
    ])
  })
})

describe('groupByDay', () => {
  const now = new Date(2026, 9, 18, 15, 0)

  it('собирает подряд идущие события одного дня и подписывает дни', () => {
    const groups = groupByDay(
      [
        event('a', new Date(2026, 9, 18, 14, 48)),
        event('b', new Date(2026, 9, 18, 12, 0)),
        event('c', new Date(2026, 9, 17, 18, 20)),
        event('d', new Date(2026, 9, 15, 11, 40)),
        event('e', new Date(2026, 9, 15, 10, 5)),
      ],
      now,
    )
    expect(groups.map((g) => [g.heading, g.items.map((i) => i.id)])).toEqual([
      ['Сегодня', ['a', 'b']],
      ['Вчера', ['c']],
      ['15 октября', ['d', 'e']],
    ])
  })

  it('пусто, если событий нет', () => {
    expect(groupByDay([], now)).toEqual([])
  })

  it('граница дня проходит по местной полуночи', () => {
    const groups = groupByDay([event('a', new Date(2026, 9, 18, 0, 1)), event('b', new Date(2026, 9, 17, 23, 59))], now)
    expect(groups.map((g) => g.heading)).toEqual(['Сегодня', 'Вчера'])
  })
})

describe('effectiveWho', () => {
  it('«все» остаётся «все», известный участник остаётся им', () => {
    expect(effectiveWho('all', ['u1', 'u2'])).toBe('all')
    expect(effectiveWho('u2', ['u1', 'u2'])).toBe('u2')
  })

  it('удалённого участника заменяет «все», а пока список не пришёл, сохранённое не трогаем', () => {
    expect(effectiveWho('gone', ['u1', 'u2'])).toBe('all')
    expect(effectiveWho('u2', undefined)).toBe('u2')
  })
})

describe('activityPath', () => {
  it('без фильтров и курсора адрес без параметров', () => {
    expect(activityPath(null, null, null)).toBe('/activity')
  })

  it('участник, тип и курсор попадают в адрес', () => {
    expect(activityPath('u1', 'doc', null)).toBe('/activity?actor=u1&kind=doc')
    expect(activityPath(null, null, '1792324800000000_6f1d')).toBe('/activity?before=1792324800000000_6f1d')
    expect(activityPath('u1', 'tasks', 'c')).toBe('/activity?actor=u1&kind=tasks&before=c')
  })
})
