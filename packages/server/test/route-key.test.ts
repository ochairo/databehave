import { describe, expect, it } from 'vitest'

import { matchPattern, parseRouteKey, parseRoutePattern } from '../src/route-key.js'
import type { RouteKey } from '../src/types.js'

describe('parseRouteKey', () => {
  it('parses a simple GET key', () => {
    expect(parseRouteKey('GET /api/v1/foo')).toEqual({ method: 'get', path: '/api/v1/foo' })
  })

  it('parses every supported method', () => {
    const cases: Array<[RouteKey, string]> = [
      ['GET /a', 'get'],
      ['POST /a', 'post'],
      ['PUT /a', 'put'],
      ['DELETE /a', 'delete'],
      ['PATCH /a', 'patch'],
    ]
    for (const [key, method] of cases) {
      expect(parseRouteKey(key)).toEqual({ method, path: '/a' })
    }
  })

  it('trims trailing whitespace from the path', () => {
    expect(parseRouteKey('GET /api/v1/foo  ' as RouteKey)).toEqual({
      method: 'get',
      path: '/api/v1/foo',
    })
  })

  it('throws on missing space', () => {
    expect(() => parseRouteKey('GET/api' as RouteKey)).toThrow(/missing space/)
  })

  it('throws on unsupported method', () => {
    expect(() => parseRouteKey('OPTIONS /api' as RouteKey)).toThrow(/unsupported method/)
  })

  it('throws when path does not start with /', () => {
    expect(() => parseRouteKey('GET api/v1' as RouteKey)).toThrow(/must start with/)
  })
})

describe('parseRoutePattern', () => {
  it('marks an all-literal path as static', () => {
    const p = parseRoutePattern('/api/v1/foo')
    expect(p.isStatic).toBe(true)
    expect(p.segments).toEqual([
      { kind: 'static', value: 'api' },
      { kind: 'static', value: 'v1' },
      { kind: 'static', value: 'foo' },
    ])
  })

  it('extracts a single :param', () => {
    const p = parseRoutePattern('/users/:id')
    expect(p.isStatic).toBe(false)
    expect(p.segments).toEqual([
      { kind: 'static', value: 'users' },
      { kind: 'param', name: 'id' },
    ])
  })

  it('extracts multiple :params in order', () => {
    const p = parseRoutePattern('/orgs/:org/repos/:repo')
    expect(p.isStatic).toBe(false)
    expect(p.segments).toHaveLength(4)
    expect(p.segments[1]).toEqual({ kind: 'param', name: 'org' })
    expect(p.segments[3]).toEqual({ kind: 'param', name: 'repo' })
  })

  it('rejects an empty param name (`:` alone)', () => {
    expect(() => parseRoutePattern('/foo/:/bar')).toThrow(/empty param name/)
  })

  it('rejects duplicate param names', () => {
    expect(() => parseRoutePattern('/foo/:id/bar/:id')).toThrow(/duplicate param/)
  })
})

describe('matchPattern', () => {
  it('matches a static path exactly', () => {
    const p = parseRoutePattern('/api/v1/foo')
    expect(matchPattern(p, '/api/v1/foo')).toEqual({})
    expect(matchPattern(p, '/api/v1/foo/extra')).toBeNull()
    expect(matchPattern(p, '/api/v1/bar')).toBeNull()
  })

  it('captures a single :param', () => {
    const p = parseRoutePattern('/users/:id')
    expect(matchPattern(p, '/users/42')).toEqual({ id: '42' })
    expect(matchPattern(p, '/users/')).toEqual({ id: '' })
    expect(matchPattern(p, '/users/42/posts')).toBeNull()
  })

  it('URL-decodes captured params', () => {
    const p = parseRoutePattern('/items/:name')
    expect(matchPattern(p, '/items/%C3%A9')).toEqual({ name: 'é' })
  })

  it('returns null for malformed %-escapes instead of throwing', () => {
    const p = parseRoutePattern('/items/:name')
    expect(matchPattern(p, '/items/%E3%81')).toBeNull()
  })

  it('requires exact segment count', () => {
    const p = parseRoutePattern('/a/:x/b')
    expect(matchPattern(p, '/a/1/b')).toEqual({ x: '1' })
    expect(matchPattern(p, '/a/1/b/c')).toBeNull()
    expect(matchPattern(p, '/a/1')).toBeNull()
  })
})
