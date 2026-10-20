import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const openUrl = vi.fn(() => Promise.resolve())
const isTauri = vi.fn(() => false)

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }))
vi.mock('./runtime', () => ({ isTauri }))

const { openExternal } = await import('./opener')

describe('openExternal', () => {
  const windowOpen = vi.fn()

  beforeEach(() => {
    openUrl.mockClear()
    windowOpen.mockClear()
    vi.stubGlobal('window', { open: windowOpen })
  })
  afterEach(() => {
    isTauri.mockReturnValue(false)
    vi.unstubAllGlobals()
  })

  it('в окне Tauri адрес уходит плагину opener: система открывает его в браузере по умолчанию', async () => {
    isTauri.mockReturnValue(true)
    await openExternal('https://example.com/repo')
    expect(openUrl).toHaveBeenCalledExactlyOnceWith('https://example.com/repo')
    expect(windowOpen).not.toHaveBeenCalled()
  })

  it('в обычном браузере (разработка, тесты) открывается новая вкладка без связи со страницей', async () => {
    await openExternal('http://example.com')
    expect(windowOpen).toHaveBeenCalledExactlyOnceWith('http://example.com', '_blank', 'noopener')
    expect(openUrl).not.toHaveBeenCalled()
  })

  it('не http и не https не открывается нигде', async () => {
    for (const mode of [true, false]) {
      isTauri.mockReturnValue(mode)
      for (const url of ['javascript:alert(1)', 'file:///C:/Windows/notepad.exe', 'tauri://localhost', 'example.com', '']) {
        await openExternal(url)
      }
    }
    expect(openUrl).not.toHaveBeenCalled()
    expect(windowOpen).not.toHaveBeenCalled()
  })

  it('схема в любом регистре подходит', async () => {
    isTauri.mockReturnValue(true)
    await openExternal('HTTPS://Example.com')
    expect(openUrl).toHaveBeenCalledWith('HTTPS://Example.com')
  })
})
