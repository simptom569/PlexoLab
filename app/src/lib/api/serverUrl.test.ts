import { describe, expect, it } from 'vitest'
import { originOf, serverCandidates, shortServerName } from './serverUrl'

describe('serverCandidates', () => {
  it('без схемы пробует https, потом http', () => {
    expect(serverCandidates('192.168.1.10:8080')).toEqual({ ok: true, urls: ['https://192.168.1.10:8080', 'http://192.168.1.10:8080'] })
    expect(serverCandidates('plexolab.example.com')).toEqual({ ok: true, urls: ['https://plexolab.example.com', 'http://plexolab.example.com'] })
  })

  it('со схемой берёт именно её, лишнее отбрасывает', () => {
    expect(serverCandidates('http://10.0.0.5:8080/')).toEqual({ ok: true, urls: ['http://10.0.0.5:8080'] })
    expect(serverCandidates('  HTTPS://Team.Example.com/api/v1  ')).toEqual({ ok: true, urls: ['https://team.example.com'] })
    expect(serverCandidates('http://localhost:8080')).toEqual({ ok: true, urls: ['http://localhost:8080'] })
  })

  it('стандартные порты не пишутся', () => {
    expect(serverCandidates('https://a.example:443')).toEqual({ ok: true, urls: ['https://a.example'] })
    expect(serverCandidates('http://a.example:80')).toEqual({ ok: true, urls: ['http://a.example'] })
  })

  it('отвергает пустое и непохожее на адрес', () => {
    for (const bad of ['', '   ', 'ftp://host', 'file:///c:/x', 'два слова', 'http://', 'http:// host']) {
      const r = serverCandidates(bad)
      expect(r.ok, `«${bad}»`).toBe(false)
      if (!r.ok) expect(r.reason).toBeTruthy()
    }
  })
})

describe('originOf', () => {
  it('оставляет только схему, хост и порт', () => {
    expect(originOf('https://a.example:8443/healthz?x=1')).toBe('https://a.example:8443')
    expect(originOf('http://[::1]:8080/')).toBe('http://[::1]:8080')
    expect(originOf('mailto:a@b.c')).toBeNull()
    expect(originOf('not a url')).toBeNull()
  })
})

describe('shortServerName', () => {
  it('показывает адрес без схемы', () => {
    expect(shortServerName('http://192.168.1.10:8080')).toBe('192.168.1.10:8080')
    expect(shortServerName('https://team.example.com')).toBe('team.example.com')
  })
})
