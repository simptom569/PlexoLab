import { describe, expect, it } from 'vitest'
import type { Notification, NotificationList } from '../../lib/api/types'
import { ToastPlanner, toastFor, toastTarget } from './toasts'

const n = (id: string, patch: Partial<Notification> = {}): Notification => ({
  id,
  kind: 'assigned',
  actor_id: null,
  project_id: 'p1',
  task_id: `t-${id}`,
  task_key: 'WEB-141',
  task_title: 'Починить вход',
  comment: null,
  read: false,
  created_at: '2026-10-18T12:00:00Z',
  ...patch,
})

const list = (...items: Notification[]): NotificationList => ({ items, unread: items.filter((i) => !i.read).length })

describe('toastFor', () => {
  it('ничего нового: окошка нет', () => {
    expect(toastFor([])).toBeNull()
  })

  it('одно: что случилось, задача, и в окошке есть куда перейти', () => {
    const toast = toastFor([n('a')])
    expect(toast?.title).toBe('Вас назначили исполнителем')
    expect(toast?.body).toBe('WEB-141 Починить вход')
    expect(toast?.extra).toEqual({ notificationId: 'a', projectId: 'p1', taskId: 't-a' })
  })

  it('упоминание: после задачи идёт отрывок комментария, лишние пробелы и переносы убраны', () => {
    const toast = toastFor([n('a', { kind: 'mentioned', comment: '  @Лена  глянь\n  правки ' })])
    expect(toast?.title).toBe('Вас упомянули в комментарии')
    expect(toast?.body).toBe('WEB-141 Починить вход\n@Лена глянь правки')
  })

  it('длинный комментарий обрезается', () => {
    const toast = toastFor([n('a', { kind: 'mentioned', comment: 'я'.repeat(500) })])
    const quote = toast!.body.split('\n')[1]!
    expect(quote.length).toBe(120)
    expect(quote.endsWith('…')).toBe(true)
  })

  it('несколько: одно окошко с числом, нажатие откроет список', () => {
    const toast = toastFor([n('a'), n('b'), n('c')])
    expect(toast).toEqual({ title: 'PlexoLab', body: 'Новых уведомлений: 3', extra: {} })
  })
})

describe('ToastPlanner', () => {
  it('после запуска всё непрочитанное приходит одним окошком', () => {
    const planner = new ToastPlanner()
    expect(planner.plan(list(n('a'), n('b'), n('c')), false)?.body).toBe('Новых уведомлений: 3')
  })

  it('прочитанное не считается', () => {
    const planner = new ToastPlanner()
    expect(planner.plan(list(n('a', { read: true })), false)).toBeNull()
  })

  it('одно и то же уведомление не показывается дважды', () => {
    const planner = new ToastPlanner()
    expect(planner.plan(list(n('a')), false)).not.toBeNull()
    expect(planner.plan(list(n('a')), false)).toBeNull()
  })

  it('новое поверх уже показанного: окошко только о новом', () => {
    const planner = new ToastPlanner()
    planner.plan(list(n('a')), false)
    const toast = planner.plan(list(n('b'), n('a')), false)
    expect(toast?.extra).toMatchObject({ notificationId: 'b' })
  })

  it('окно перед глазами: окошка нет, и позже о том же оно не появится', () => {
    const planner = new ToastPlanner()
    expect(planner.plan(list(n('a')), true)).toBeNull()
    expect(planner.plan(list(n('a')), false)).toBeNull()
  })

  it('выключатель «Уведомления Windows» выключен: окошка нет, а после включения старое не приходит', () => {
    const planner = new ToastPlanner()
    expect(planner.plan(list(n('a'), n('b')), false, false)).toBeNull()
    expect(planner.plan(list(n('a'), n('b')), false, true)).toBeNull()
    // новое после включения показывается как обычно
    expect(planner.plan(list(n('c'), n('a'), n('b')), false, true)?.extra).toMatchObject({ notificationId: 'c' })
  })

  it('прочитал в другом окне: ничего не показывается', () => {
    const planner = new ToastPlanner()
    planner.plan(list(n('a')), false)
    expect(planner.plan(list(n('a', { read: true })), false)).toBeNull()
  })

  it('«назначили» по той же задаче заменено свежим (другой id): окошко о свежем', () => {
    const planner = new ToastPlanner()
    planner.plan(list(n('a', { task_id: 't1' })), false)
    const toast = planner.plan(list(n('b', { task_id: 't1' })), false)
    expect(toast?.extra).toMatchObject({ notificationId: 'b', taskId: 't1' })
  })

  it('выпавшее из списка забывается, не копится', () => {
    const planner = new ToastPlanner()
    planner.plan(list(n('a'), n('b')), false)
    planner.plan(list(n('b')), false)
    // a вернулся в список непрочитанным (человека вернули в проект): сказать о нём снова можно
    expect(planner.plan(list(n('a'), n('b')), false)?.extra).toMatchObject({ notificationId: 'a' })
  })
})

describe('toastTarget', () => {
  it('из окошка об одной задаче достаёт задачу', () => {
    expect(toastTarget({ notificationId: 'a', projectId: 'p1', taskId: 't1' })).toEqual({
      kind: 'task',
      notificationId: 'a',
      projectId: 'p1',
      taskId: 't1',
    })
  })

  it('пачка и непонятное: открывается список', () => {
    expect(toastTarget({})).toEqual({ kind: 'list' })
    expect(toastTarget({ notificationId: 'a', projectId: 1, taskId: null })).toEqual({ kind: 'list' })
  })
})
