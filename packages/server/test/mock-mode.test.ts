import { describe, expect, it, vi } from 'vitest'

import {
  buildMockModeHooks,
  resolveStatus,
  type BodyResolver,
  type MockModeConfig,
} from '../src/mock-mode.js'
import type { MockRequest } from '../src/index.js'

const baseReq = (method: string, path: string): MockRequest =>
  ({
    method,
    path,
    url: `http://localhost${path}`,
    query: {},
    headers: {},
    json: async () => null,
    text: async () => '',
  }) as unknown as MockRequest

describe('resolveStatus', () => {
  it('returns undefined when nothing is configured (passthrough)', () => {
    expect(resolveStatus('GET', '/api/v1/x', {})).toBeUndefined()
  })

  it('returns defaultStatus when no pathOverrides match', () => {
    expect(
      resolveStatus('GET', '/api/v1/x', { defaultStatus: 500 }),
    ).toBe(500)
  })

  it('returns path-only override regardless of method', () => {
    const cfg: MockModeConfig = {
      pathOverrides: { '/api/v1/x': 404 },
    }
    expect(resolveStatus('GET', '/api/v1/x', cfg)).toBe(404)
    expect(resolveStatus('POST', '/api/v1/x', cfg)).toBe(404)
  })

  it('prefers "METHOD path" over path-only and defaultStatus', () => {
    const cfg: MockModeConfig = {
      defaultStatus: 500,
      pathOverrides: {
        '/api/v1/x': 404,
        'POST /api/v1/x': 400,
      },
    }
    expect(resolveStatus('POST', '/api/v1/x', cfg)).toBe(400)
    expect(resolveStatus('GET', '/api/v1/x', cfg)).toBe(404)
    expect(resolveStatus('GET', '/api/v1/y', cfg)).toBe(500)
  })
})

describe('buildMockModeHooks', () => {
  it('returns undefined when disabled', () => {
    expect(buildMockModeHooks({ enabled: false })).toBeUndefined()
    expect(buildMockModeHooks({})).toBeUndefined()
  })

  describe('onRequest', () => {
    it('passes through (returns undefined) when no status matches', () => {
      const hooks = buildMockModeHooks({ enabled: true })!
      expect(hooks.onRequest!(baseReq('GET', '/api/v1/foo'))).toBeUndefined()
    })

    it('synthesizes minimal envelope when no body resolver is provided', () => {
      const hooks = buildMockModeHooks({
        enabled: true,
        defaultStatus: 500,
      })!
      const res = hooks.onRequest!(baseReq('GET', '/api/v1/foo')) as {
        status: number
        json: unknown
        headers: Record<string, string>
      }
      expect(res.status).toBe(500)
      expect(res.json).toEqual({ error: true, status: 500 })
      expect(res.headers['x-mock-status']).toBe('500')
    })

    it('returns empty body for status 204', () => {
      const hooks = buildMockModeHooks({
        enabled: true,
        defaultStatus: 204,
      })!
      const res = hooks.onRequest!(baseReq('GET', '/api/v1/foo')) as {
        status: number
        empty?: boolean
        json?: unknown
        headers: Record<string, string>
      }
      expect(res.status).toBe(204)
      expect(res.empty).toBe(true)
      expect(res.json).toBeUndefined()
      expect(res.headers['x-mock-status']).toBe('204')
    })

    it('exempts paths listed in healthPaths from short-circuit', () => {
      const hooks = buildMockModeHooks({
        enabled: true,
        defaultStatus: 500,
        healthPaths: ['/health'],
      })!
      expect(hooks.onRequest!(baseReq('GET', '/health'))).toBeUndefined()
    })

    it('uses a custom header name when configured', () => {
      const hooks = buildMockModeHooks({
        enabled: true,
        header: 'x-test-status',
        defaultStatus: 500,
      })!
      const res = hooks.onRequest!(baseReq('GET', '/x')) as {
        headers: Record<string, string>
      }
      expect(res.headers['x-test-status']).toBe('500')
      expect(res.headers['x-mock-status']).toBeUndefined()
    })
  })

  describe('body resolver', () => {
    it('uses the resolver-provided body when it returns a value', () => {
      const resolver: BodyResolver = vi.fn(
        (_m, _p, status) => ({ generated: true, code: status }),
      )
      const hooks = buildMockModeHooks(
        {
          enabled: true,
          defaultStatus: 500,
        },
        resolver,
      )!
      const res = hooks.onRequest!(baseReq('GET', '/api/v1/foo')) as {
        json: unknown
      }
      expect(res.json).toEqual({ generated: true, code: 500 })
      expect(resolver).toHaveBeenCalledWith('GET', '/api/v1/foo', 500)
    })

    it('falls back to envelope when resolver returns undefined', () => {
      const resolver: BodyResolver = () => undefined
      const hooks = buildMockModeHooks(
        { enabled: true, defaultStatus: 404 },
        resolver,
      )!
      const res = hooks.onRequest!(baseReq('GET', '/api/v1/foo')) as {
        json: unknown
      }
      expect(res.json).toEqual({ error: true, status: 404 })
    })

    it('bypasses the resolver for status 204 (always empty body)', () => {
      const resolver: BodyResolver = vi.fn(() => ({ should: 'not-be-used' }))
      const hooks = buildMockModeHooks(
        { enabled: true, defaultStatus: 204 },
        resolver,
      )!
      const res = hooks.onRequest!(baseReq('GET', '/x')) as {
        empty?: boolean
        json?: unknown
      }
      expect(res.empty).toBe(true)
      expect(res.json).toBeUndefined()
      expect(resolver).not.toHaveBeenCalled()
    })
  })

  describe('pathOverrides integration', () => {
    it('selects different statuses per route in onRequest', () => {
      const hooks = buildMockModeHooks({
        enabled: true,
        pathOverrides: {
          'GET /api/v1/a': 404,
          '/api/v1/b': 500,
        },
      })!
      const a = hooks.onRequest!(baseReq('GET', '/api/v1/a')) as { status: number }
      const b = hooks.onRequest!(baseReq('POST', '/api/v1/b')) as { status: number }
      const c = hooks.onRequest!(baseReq('GET', '/api/v1/c'))
      expect(a.status).toBe(404)
      expect(b.status).toBe(500)
      expect(c).toBeUndefined()
    })
  })

  describe('onResponse tagging', () => {
    it('tags every non-health response with the resolved status', () => {
      const hooks = buildMockModeHooks({ enabled: true })!
      const out = hooks.onResponse!(
        baseReq('GET', '/api/v1/foo'),
        { json: { ok: true }, status: 200 },
      )
      const h = (out as { headers?: Record<string, string> }).headers ?? {}
      expect(h['x-mock-status']).toBe('200')
    })

    it('uses the response status (not the configured override) for tagging', () => {
      const hooks = buildMockModeHooks({
        enabled: true,
        defaultStatus: 500,
      })!
      const out = hooks.onResponse!(
        baseReq('GET', '/api/v1/foo'),
        { json: { ok: true }, status: 201 },
      )
      const h = (out as { headers?: Record<string, string> }).headers ?? {}
      expect(h['x-mock-status']).toBe('201')
    })

    it('defaults to 200 when response has no status', () => {
      const hooks = buildMockModeHooks({ enabled: true })!
      const out = hooks.onResponse!(
        baseReq('GET', '/api/v1/foo'),
        { json: { ok: true } },
      )
      const h = (out as { headers?: Record<string, string> }).headers ?? {}
      expect(h['x-mock-status']).toBe('200')
    })

    it('passes through healthPath responses unchanged', () => {
      const hooks = buildMockModeHooks({
        enabled: true,
        healthPaths: ['/health'],
      })!
      const original = { json: { ok: true } }
      const out = hooks.onResponse!(baseReq('GET', '/health'), original)
      expect(out).toBe(original)
    })

    it('uses a custom header name when configured', () => {
      const hooks = buildMockModeHooks({
        enabled: true,
        header: 'x-test-status',
      })!
      const out = hooks.onResponse!(
        baseReq('GET', '/x'),
        { json: { ok: true }, status: 200 },
      )
      const h = (out as { headers?: Record<string, string> }).headers ?? {}
      expect(h['x-test-status']).toBe('200')
      expect(h['x-mock-status']).toBeUndefined()
    })

    it('skips re-tagging when handler-supplied header matches case-insensitively', () => {
      const hooks = buildMockModeHooks({ enabled: true })!
      const original: import('../src/index.js').MockResponse = {
        json: { ok: true },
        status: 200,
        // Title-Case header from a handler must still be recognised
        // against the lowercase configured tag name.
        headers: { 'X-Mock-Status': 'pre-set' },
      }
      const out = hooks.onResponse!(baseReq('GET', '/x'), original)
      const h = (out as { headers: Record<string, string> }).headers
      // Original header preserved verbatim, no duplicate `x-mock-status` added.
      expect(h['X-Mock-Status']).toBe('pre-set')
      expect(h['x-mock-status']).toBeUndefined()
    })
  })

  describe('allowHeaderOverride', () => {
    const withHeader = (
      method: string,
      path: string,
      headers: Record<string, string>,
    ): MockRequest =>
      ({ ...baseReq(method, path), headers }) as MockRequest

    it('is ignored when allowHeaderOverride is not enabled', () => {
      const hooks = buildMockModeHooks({ enabled: true })!
      const res = hooks.onRequest!(
        withHeader('GET', '/x', { 'x-mock-status': '500' }),
      )
      expect(res).toBeUndefined()
    })

    it('forces the requested status when allowHeaderOverride is enabled', () => {
      const hooks = buildMockModeHooks({
        enabled: true,
        allowHeaderOverride: true,
      })!
      const res = hooks.onRequest!(
        withHeader('GET', '/x', { 'x-mock-status': '503' }),
      )
      expect(res?.status).toBe(503)
    })

    it('beats pathOverrides and defaultStatus', () => {
      const hooks = buildMockModeHooks({
        enabled: true,
        allowHeaderOverride: true,
        defaultStatus: 500,
        pathOverrides: { '/x': 404 },
      })!
      const res = hooks.onRequest!(
        withHeader('GET', '/x', { 'x-mock-status': '418' }),
      )
      expect(res?.status).toBe(418)
    })

    it('rejects out-of-range / non-numeric header values and warns', () => {
      const hooks = buildMockModeHooks({
        enabled: true,
        allowHeaderOverride: true,
      })!
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        expect(hooks.onRequest!(withHeader('GET', '/x', { 'x-mock-status': '99' })))
          .toBeUndefined()
        expect(hooks.onRequest!(withHeader('GET', '/x', { 'x-mock-status': '600' })))
          .toBeUndefined()
        expect(hooks.onRequest!(withHeader('GET', '/x', { 'x-mock-status': 'foo' })))
          .toBeUndefined()
        // One warn per ignored header so a typo isn't silently swallowed.
        expect(warn).toHaveBeenCalledTimes(3)
        for (const call of warn.mock.calls) {
          expect(String(call[0])).toMatch(/ignored x-mock-status=/)
        }
      } finally {
        warn.mockRestore()
      }
    })

    it('honours the custom `header` name for both directions', () => {
      const hooks = buildMockModeHooks({
        enabled: true,
        allowHeaderOverride: true,
        header: 'x-test-status',
      })!
      const res = hooks.onRequest!(
        withHeader('GET', '/x', { 'x-test-status': '502' }),
      )
      expect(res?.status).toBe(502)
    })
  })
})
