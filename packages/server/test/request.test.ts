/**
 * Unit tests for {@link buildRequest} — the facade the
 * server wraps every incoming web `Request` in before handing it to
 * a user handler.
 *
 * The integration tests (server / hooks) exercise this through real
 * routes; this file pins the facade's *contract* in isolation so a
 * refactor of either side surfaces a focused failure.
 */
import { describe, expect, it } from 'vitest'

import { buildRequest } from '../src/request.js'

describe('buildRequest', () => {
  it('lower-cases header keys and exposes path / method / url verbatim', () => {
    const r = buildRequest(
      new Request('http://localhost/a/b?x=1', {
        method: 'POST',
        headers: { 'X-Custom-Hdr': 'v', 'Content-Type': 'application/json' },
      }),
    )
    expect(r.method).toBe('post')
    expect(r.url).toBe('http://localhost/a/b?x=1')
    expect(r.path).toBe('/a/b')
    expect(r.headers['x-custom-hdr']).toBe('v')
    expect(r.headers['content-type']).toBe('application/json')
  })

  it('deduplicates `query` (last value wins) but preserves all in `queryAll`', () => {
    const r = buildRequest(
      new Request('http://localhost/q?k=1&k=2&k=3&other=x'),
    )
    expect(r.query).toEqual({ k: '3', other: 'x' })
    expect(r.queryAll).toEqual({ k: ['1', '2', '3'], other: ['x'] })
  })

  it('defaults `params` to an empty object when the caller omits it', () => {
    const r = buildRequest(new Request('http://localhost/p'))
    expect(r.params).toEqual({})
  })

  it('forwards the supplied `params` map without mutation', () => {
    const params = Object.freeze({ id: '42', slug: 'abc' })
    const r = buildRequest(new Request('http://localhost/p'), params)
    // `toEqual` instead of `toBe` so a future defensive copy in the
    // facade doesn't fail this test for a non-bug reason. The
    // important invariant is the values flow through unchanged.
    expect(r.params).toEqual(params)
  })

  it('`raw()` returns the original web `Request` reference', () => {
    const original = new Request('http://localhost/raw')
    const r = buildRequest(original)
    expect(r.raw()).toBe(original)
  })

  it('shares one body read across `json()` + `text()` and across re-builds', async () => {
    const original = new Request('http://localhost/body', {
      method: 'POST',
      body: JSON.stringify({ v: 1 }),
      headers: { 'content-type': 'application/json' },
    })

    const first = buildRequest(original)
    expect(await first.json()).toEqual({ v: 1 })
    // Same facade, second read of cached body promise — must not throw
    // (would throw if the body had already been consumed without caching).
    expect(await first.text()).toBe('{"v":1}')

    // Router pattern: build a *second* facade from the same Request to
    // attach resolved path params. Body cache is keyed on the Request,
    // so re-reads stay safe.
    const second = buildRequest(original, { id: 'x' })
    expect(await second.json()).toEqual({ v: 1 })
  })
})
