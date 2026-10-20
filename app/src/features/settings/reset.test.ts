import { beforeEach, describe, expect, it, vi } from 'vitest'

// запись на диск здесь не нужна: смотрим на состояние и на то, что именно пошло на запись
const saved = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.mock('../../lib/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/settings')>()),
  saveSettings: (patch: Record<string, unknown>) => void saved.push(patch),
}))

import { DEFAULT_SETTINGS } from '../../lib/settings'
import { useUi } from '../../lib/ui-store'
import { useActivityStore } from '../activity/store'
import { useDocsStore } from '../docs/store'
import { useWikiStore } from '../wiki/store'
import { resetLocalSettings } from './reset'

const customize = () => {
  useUi.setState({
    theme: 'dark',
    scrollbars: 'hidden',
    weekStart: 'sun',
    live: false,
    page: 'wiki',
    project: 'p1',
    view: 'cal',
    filters: { who: ['u1'], prio: ['high'], tag: [], module: [], due: 'week' },
    display: { ...DEFAULT_SETTINGS.display, pr: false },
    q: 'вход',
  })
  useWikiStore.setState({ pageId: 'w1' })
  useDocsStore.setState({ docId: 'd1', starOnly: true })
  useActivityStore.setState({ who: 'u2', kind: 'code' })
}

describe('сброс локальных настроек', () => {
  beforeEach(() => {
    customize()
    saved.length = 0
  })

  it('«Сбросить всё» возвращает значения по умолчанию во всех хранилищах', () => {
    resetLocalSettings()
    expect(useUi.getState()).toMatchObject({
      theme: DEFAULT_SETTINGS.theme,
      scrollbars: 'visible',
      weekStart: 'mon',
      live: true,
      page: 'board',
      project: null,
      view: 'board',
      filters: DEFAULT_SETTINGS.filters,
      display: DEFAULT_SETTINGS.display,
      q: '',
    })
    expect(useWikiStore.getState().pageId).toBeNull()
    expect(useDocsStore.getState()).toMatchObject({ docId: null, starOnly: false })
    expect(useActivityStore.getState()).toMatchObject({ who: 'all', kind: 'all' })
  })

  it('на диск уходят новые значения, адрес сервера и e-mail не трогаются', () => {
    resetLocalSettings()
    const written = Object.assign({}, ...saved)
    expect(written).toMatchObject({ theme: 'light', scrollbars: 'visible', weekStart: 'mon', live: true, page: 'board', wikiPage: null, docOpen: null, docStar: false, actWho: 'all', actKind: 'all' })
    expect(written).not.toHaveProperty('serverUrl')
    expect(written).not.toHaveProperty('lastEmail')
  })

  it('«Сбросить фильтры и вид» не трогает тему, полосы прокрутки и первый день недели', () => {
    useUi.getState().resetView()
    expect(useUi.getState()).toMatchObject({
      view: 'board',
      filters: DEFAULT_SETTINGS.filters,
      display: DEFAULT_SETTINGS.display,
      q: '',
      theme: 'dark',
      scrollbars: 'hidden',
      weekStart: 'sun',
      live: false,
      page: 'wiki',
    })
  })
})
