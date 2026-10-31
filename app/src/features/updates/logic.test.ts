import { describe, expect, it } from 'vitest'
import { applyDownloadEvent, pendingVersion, percentOf, START_PROGRESS, updateView, type UpdatePhase } from './logic'

describe('applyDownloadEvent и percentOf', () => {
  it('размер известен: проценты растут по кускам и доходят до сотни по окончании', () => {
    let p = applyDownloadEvent(START_PROGRESS, { event: 'Started', data: { contentLength: 1000 } })
    expect(percentOf(p)).toBe(0)
    p = applyDownloadEvent(p, { event: 'Progress', data: { chunkLength: 250 } })
    p = applyDownloadEvent(p, { event: 'Progress', data: { chunkLength: 333 } })
    expect(percentOf(p)).toBe(58)
    p = applyDownloadEvent(p, { event: 'Finished' })
    expect(percentOf(p)).toBe(100)
  })

  it('размер неизвестен или нулевой: процентов нет, куски всё равно считаются', () => {
    for (const data of [{}, { contentLength: 0 }]) {
      let p = applyDownloadEvent(START_PROGRESS, { event: 'Started', data })
      p = applyDownloadEvent(p, { event: 'Progress', data: { chunkLength: 10 } })
      expect(p.received).toBe(10)
      expect(percentOf(p)).toBeNull()
      expect(percentOf(applyDownloadEvent(p, { event: 'Finished' }))).toBeNull()
    }
  })

  it('кусков пришло больше, чем размер: не больше 100', () => {
    let p = applyDownloadEvent(START_PROGRESS, { event: 'Started', data: { contentLength: 100 } })
    p = applyDownloadEvent(p, { event: 'Progress', data: { chunkLength: 150 } })
    expect(percentOf(p)).toBe(100)
  })
})

describe('pendingVersion', () => {
  it('напоминает о версии, пока она найдена и не установлена', () => {
    expect(pendingVersion({ kind: 'available', version: '1.2.0' })).toBe('1.2.0')
    expect(pendingVersion({ kind: 'downloading', version: '1.2.0', percent: 40 })).toBe('1.2.0')
    expect(pendingVersion({ kind: 'error', during: 'install', version: '1.2.0' })).toBe('1.2.0')
  })

  it('больше ни в каких состояниях не напоминает', () => {
    const quiet: UpdatePhase[] = [{ kind: 'idle' }, { kind: 'checking' }, { kind: 'upToDate' }, { kind: 'error', during: 'check' }]
    for (const phase of quiet) expect(pendingVersion(phase)).toBeNull()
  })
})

describe('updateView', () => {
  it('в браузере кнопка выключена и объясняет почему', () => {
    const view = updateView({ kind: 'idle' }, false)
    expect(view.button.disabled).toBe(true)
    expect(view.description).toMatch(/только в приложении/)
  })

  it('в приложении по умолчанию можно проверить', () => {
    const view = updateView({ kind: 'idle' }, true)
    expect(view.button).toMatchObject({ action: 'check', disabled: false, label: 'Проверить обновления' })
    expect(view.problem).toBeNull()
  })

  it('идёт проверка: кнопка выключена', () => {
    expect(updateView({ kind: 'checking' }, true).button.disabled).toBe(true)
  })

  it('новая версия найдена: главная кнопка ставит её', () => {
    const view = updateView({ kind: 'available', version: '1.1.0' }, true)
    expect(view.description).toContain('1.1.0')
    expect(view.button).toMatchObject({ action: 'install', primary: true, disabled: false })
  })

  it('скачивание: проценты в описании, кнопка выключена; размер неизвестен: многоточие', () => {
    const withPercent = updateView({ kind: 'downloading', version: '1.1.0', percent: 40 }, true)
    expect(withPercent.description).toBe('Скачиваю версию 1.1.0: 40%')
    expect(withPercent.button.disabled).toBe(true)
    expect(updateView({ kind: 'downloading', version: '1.1.0', percent: null }, true).description).toBe('Скачиваю версию 1.1.0…')
  })

  it('ошибка проверки: можно проверить снова; ошибка установки: можно повторить установку', () => {
    const check = updateView({ kind: 'error', during: 'check' }, true)
    expect(check.problem).toMatch(/проверить обновления/)
    expect(check.button.action).toBe('check')
    const install = updateView({ kind: 'error', during: 'install', version: '1.1.0' }, true)
    expect(install.problem).toMatch(/установить/)
    expect(install.button).toMatchObject({ action: 'install', label: 'Повторить', disabled: false })
  })
})
