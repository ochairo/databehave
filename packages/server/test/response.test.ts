/**
 * Unit tests for {@link buildResponse} — the serializer that turns a
 * `MockResponse` POJO into a web `Response`.
 *
 * Each body variant (`json`, `text`, `html`, `raw`, `empty`) is its
 * own branch, plus the header merge and the missing-variant guard.
 */
import { describe, expect, it } from 'vitest'

import { buildResponse } from '../src/response.js'

describe('buildResponse', () => {
  it('serializes `json` with `application/json; charset=utf-8` and default 200', async () => {
    const r = buildResponse({ json: { ok: true, n: 7 } })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(await r.json()).toEqual({ ok: true, n: 7 })
  })

  it('serializes `text` with `text/plain; charset=utf-8`', async () => {
    const r = buildResponse({ text: 'hello', status: 201 })
    expect(r.status).toBe(201)
    expect(r.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await r.text()).toBe('hello')
  })

  it('serializes `html` with `text/html; charset=utf-8`', async () => {
    const r = buildResponse({ html: '<p>hi</p>' })
    expect(r.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await r.text()).toBe('<p>hi</p>')
  })

  it('passes `raw` body through without injecting a Content-Type', async () => {
    const r = buildResponse({
      raw: 'binary-ish',
      headers: { 'content-type': 'application/octet-stream' },
    })
    expect(r.headers.get('content-type')).toBe('application/octet-stream')
    expect(await r.text()).toBe('binary-ish')
  })

  it('emits a body-less response when `empty: true`', async () => {
    const r = buildResponse({ empty: true, status: 204 })
    expect(r.status).toBe(204)
    expect(r.headers.get('content-type')).toBeNull()
    expect(await r.text()).toBe('')
  })

  it('lets user headers override the variant-derived Content-Type', async () => {
    const r = buildResponse({
      json: { v: 1 },
      headers: { 'Content-Type': 'application/vnd.api+json' },
    })
    expect(r.headers.get('content-type')).toBe('application/vnd.api+json')
    expect(await r.json()).toEqual({ v: 1 })
  })

  it('throws a clear error when no body variant is supplied', () => {
    expect(() => buildResponse({} as never)).toThrow(/body variant missing/)
  })
})
