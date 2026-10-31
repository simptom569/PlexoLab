import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleCloseRequest } from '../../lib/closeGuard'
import { checkForUpdate, type DownloadEvent, type FoundUpdate } from '../../lib/platform/updater'
import { useUpdates } from './store'

vi.mock('../../lib/platform/updater', () => ({ checkForUpdate: vi.fn() }))
vi.mock('../../lib/closeGuard', () => ({ handleCloseRequest: vi.fn() }))

const check = vi.mocked(checkForUpdate)
const closeRequest = vi.mocked(handleCloseRequest)

/** Найденное обновление; `install` по умолчанию показывает три куска из тысячи байт и заканчивает */
function update(version = '1.1.0', install?: FoundUpdate['install']): FoundUpdate {
  return {
    version,
    install:
      install ??
      vi.fn(async (onEvent: (event: DownloadEvent) => void) => {
        onEvent({ event: 'Started', data: { contentLength: 1000 } })
        onEvent({ event: 'Progress', data: { chunkLength: 500 } })
        onEvent({ event: 'Finished' })
      }),
  }
}

const phase = () => useUpdates.getState().phase

beforeEach(() => {
  vi.resetAllMocks()
  useUpdates.setState({ phase: { kind: 'idle' } })
  closeRequest.mockResolvedValue('close')
})

describe('проверка', () => {
  it('по кнопке: «проверяю», потом «последняя версия»', async () => {
    let finish: (value: FoundUpdate | null) => void = () => undefined
    check.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const run = useUpdates.getState().check()
    expect(phase()).toEqual({ kind: 'checking' })
    finish(null)
    await run
    expect(phase()).toEqual({ kind: 'upToDate' })
  })

  it('нашлась новая версия: доступна', async () => {
    check.mockResolvedValue(update('1.2.0'))
    await useUpdates.getState().check()
    expect(phase()).toEqual({ kind: 'available', version: '1.2.0' })
  })

  it('фоновая проверка ничего не показывает, пока нечего показать', async () => {
    check.mockResolvedValue(null)
    const seen: string[] = []
    const stop = useUpdates.subscribe((s) => seen.push(s.phase.kind))
    await useUpdates.getState().check({ silent: true })
    stop()
    expect(seen).toEqual([])
    expect(phase()).toEqual({ kind: 'idle' })
  })

  it('фоновая проверка находит версию: она доступна', async () => {
    check.mockResolvedValue(update('1.2.0'))
    await useUpdates.getState().check({ silent: true })
    expect(phase()).toEqual({ kind: 'available', version: '1.2.0' })
  })

  it('фоновая проверка не нашла того, что нашла раньше: версия больше не доступна', async () => {
    check.mockResolvedValueOnce(update('1.2.0')).mockResolvedValueOnce(null)
    await useUpdates.getState().check({ silent: true })
    await useUpdates.getState().check({ silent: true })
    expect(phase()).toEqual({ kind: 'idle' })
  })

  it('ошибка: по кнопке показывается, в фоне молчит', async () => {
    check.mockRejectedValue(new Error('нет связи'))
    await useUpdates.getState().check({ silent: true })
    expect(phase()).toEqual({ kind: 'idle' })
    await useUpdates.getState().check()
    expect(phase()).toEqual({ kind: 'error', during: 'check' })
  })

  it('пока скачивается, новая проверка не запускается', async () => {
    useUpdates.setState({ phase: { kind: 'downloading', version: '1.1.0', percent: 10 } })
    await useUpdates.getState().check()
    expect(check).not.toHaveBeenCalled()
  })
})

describe('установка', () => {
  it('без найденной версии ничего не делает', async () => {
    await useUpdates.getState().install()
    expect(closeRequest).not.toHaveBeenCalled()
    expect(phase()).toEqual({ kind: 'idle' })
  })

  it('есть неотправленный текст и человек остался: не ставит и версия остаётся доступной', async () => {
    const found = update()
    check.mockResolvedValue(found)
    await useUpdates.getState().check()
    closeRequest.mockResolvedValue('stay')
    await useUpdates.getState().install()
    expect(found.install).not.toHaveBeenCalled()
    expect(phase()).toEqual({ kind: 'available', version: '1.1.0' })
  })

  it('показывает проценты скачивания и ставит', async () => {
    const found = update('1.1.0', async (onEvent) => {
      onEvent({ event: 'Started', data: { contentLength: 1000 } })
      percents.push(percentNow())
      onEvent({ event: 'Progress', data: { chunkLength: 500 } })
      percents.push(percentNow())
    })
    const percents: Array<number | null> = []
    const percentNow = () => (phase().kind === 'downloading' ? (phase() as { percent: number | null }).percent : null)
    check.mockResolvedValue(found)
    await useUpdates.getState().check()
    await useUpdates.getState().install()
    expect(percents).toEqual([0, 50])
    expect(closeRequest).toHaveBeenCalledTimes(1)
  })

  it('не вышло: ошибка с версией, и повтор ставит ту же версию', async () => {
    const install = vi.fn<FoundUpdate['install']>().mockRejectedValueOnce(new Error('обрыв')).mockResolvedValueOnce(undefined)
    check.mockResolvedValue(update('1.1.0', install))
    await useUpdates.getState().check()
    await useUpdates.getState().install()
    expect(phase()).toEqual({ kind: 'error', during: 'install', version: '1.1.0' })
    await useUpdates.getState().install()
    expect(install).toHaveBeenCalledTimes(2)
    expect(phase().kind).toBe('downloading')
  })
})
