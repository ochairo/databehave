/**
 * Tests for `src/cors.ts`: preflight handling, `Access-Control-*`
 * response decoration, Vary merge logic, and the `mergeVary` unit
 * helper. Hook-related describes that used to live here moved into
 * `server.test.ts` (hooks are server.ts plumbing, not cors.ts).
 */
import { describe, expect, it } from 'vitest'

import { createServer } from '../src/index.js'
import { mergeVary } from '../src/cors.js'

describe('cors', () => {
  it('answers preflight OPTIONS without invoking handlers', async () => {
    let handlerCalled = false
    const server = createServer({
      cors: { exposeHeaders: ['x-mock-mode'] },
      routes: {
        'GET /api/v1/foo': () => {
          handlerCalled = true
          return { json: { ok: true } }
        },
      },
    })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/foo', {
        method: 'OPTIONS',
        headers: {
          origin: 'http://app.example.com',
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'content-type, x-custom',
        },
      }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('http://app.example.com')
    expect(res.headers.get('access-control-allow-methods')).toMatch(/GET/)
    // Echoes back requested headers so preflight always satisfies the browser.
    expect(res.headers.get('access-control-allow-headers')).toBe('content-type, x-custom')
    expect(handlerCalled).toBe(false)
  })

  it('decorates handler responses with CORS headers but does not override existing keys', async () => {
    const server = createServer({
      cors: {
        origin: () => 'https://allowed.example',
        credentials: true,
        exposeHeaders: ['x-mock-mode'],
      },
      routes: {
        'GET /api/v1/foo': () => ({
          json: { ok: true },
          headers: { 'access-control-allow-origin': 'override-me' },
        }),
      },
    })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/foo', {
        headers: { origin: 'http://app.example.com' },
      }),
    )
    // Handler-set value wins over the auto-CORS value.
    expect(res.headers.get('access-control-allow-origin')).toBe('override-me')
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
    expect(res.headers.get('access-control-expose-headers')).toBe('x-mock-mode')
  })

  it('mirrors a missing Origin header to `*`', async () => {
    const server = createServer({
      cors: {},
      routes: { 'GET /api/v1/foo': () => ({ json: { ok: true } }) },
    })
    const res = await server.fetch(new Request('http://localhost/api/v1/foo'))
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('sets Vary: Origin on every CORS-decorated response', async () => {
    const server = createServer({
      cors: { origin: (o) => o },
      routes: { 'GET /api/v1/foo': () => ({ json: { ok: true } }) },
    })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/foo', {
        headers: { origin: 'https://app.example.com' },
      }),
    )
    expect(res.headers.get('vary')).toBe('Origin')
  })

  it('omits Access-Control-Allow-Origin when the origin resolver returns empty', async () => {
    const server = createServer({
      cors: { origin: () => '' },
      routes: { 'GET /api/v1/foo': () => ({ json: { ok: true } }) },
    })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/foo', {
        headers: { origin: 'https://blocked.example' },
      }),
    )
    expect(res.headers.has('access-control-allow-origin')).toBe(false)
    // Vary still set so caches do not poison.
    expect(res.headers.get('vary')).toBe('Origin')
  })

  it('omits Access-Control-Allow-Origin on preflights when resolver returns empty', async () => {
    const server = createServer({
      cors: { origin: () => '' },
      routes: { 'GET /api/v1/foo': () => ({ json: { ok: true } }) },
    })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/foo', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://blocked.example',
          'access-control-request-method': 'GET',
        },
      }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.has('access-control-allow-origin')).toBe(false)
    expect(res.headers.get('vary')).toContain('Origin')
  })

  it('merges (not replaces) a handler-set Vary with the CORS Vary token', async () => {
    const server = createServer({
      cors: { origin: (o) => o },
      routes: {
        'GET /api/v1/foo': () => ({
          json: { ok: true },
          headers: { vary: 'Accept-Encoding' },
        }),
      },
    })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/foo', {
        headers: { origin: 'https://app.example.com' },
      }),
    )
    const vary = res.headers.get('vary') ?? ''
    const tokens = vary.split(',').map((t) => t.trim().toLowerCase())
    expect(tokens).toContain('origin')
    expect(tokens).toContain('accept-encoding')
  })

  it('deduplicates Vary tokens case-insensitively', async () => {
    const server = createServer({
      cors: { origin: (o) => o },
      routes: {
        'GET /api/v1/foo': () => ({
          json: { ok: true },
          headers: { vary: 'origin, Accept-Encoding' },
        }),
      },
    })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/foo', {
        headers: { origin: 'https://app.example.com' },
      }),
    )
    const tokens = (res.headers.get('vary') ?? '').split(',').map((t) => t.trim().toLowerCase())
    expect(tokens.filter((t) => t === 'origin')).toHaveLength(1)
  })

  it('honours Vary: * by collapsing the merged value', async () => {
    const server = createServer({
      cors: { origin: (o) => o },
      routes: {
        'GET /api/v1/foo': () => ({
          json: { ok: true },
          headers: { vary: '*' },
        }),
      },
    })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/foo', {
        headers: { origin: 'https://app.example.com' },
      }),
    )
    expect(res.headers.get('vary')).toBe('*')
  })
})

describe('mergeVary (unit)', () => {
  it('returns the additional token when there is no existing value', () => {
    expect(mergeVary(undefined, 'Origin')).toBe('Origin')
    expect(mergeVary('', 'Origin')).toBe('Origin')
  })

  it('short-circuits to `*` when either side is `*`', () => {
    expect(mergeVary('*', 'Origin')).toBe('*')
    expect(mergeVary('Origin', '*')).toBe('*')
    expect(mergeVary('Accept-Encoding, *', 'Origin')).toBe('*')
  })

  it('preserves the first-seen casing and skips empty / whitespace tokens', () => {
    expect(mergeVary('Accept-Encoding, ,  ', 'origin')).toBe('Accept-Encoding, origin')
  })

  it('appends novel tokens from the additional value', () => {
    expect(mergeVary('Origin', 'Accept-Encoding')).toBe('Origin, Accept-Encoding')
  })
})

describe('CORS preflight', () => {
  it('echoes Access-Control-Request-Headers, applies credentials + custom maxAge', async () => {
    const server = createServer({
      cors: {
        origin: (o) => (o === '' ? '*' : o),
        credentials: true,
        maxAge: 600,
      },
      routes: {},
    })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/anything', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://app.example.com',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'x-custom, x-trace',
        },
      }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-headers')).toBe('x-custom, x-trace')
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
    expect(res.headers.get('access-control-max-age')).toBe('600')
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com')
    expect(res.headers.get('vary')).toBe('Origin')
  })

  it('omits Allow-Origin and Allow-Credentials when resolver returns empty and credentials is false', async () => {
    const server = createServer({
      cors: { origin: () => '' },
      routes: {},
    })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/anything', {
        method: 'OPTIONS',
        headers: { origin: 'https://blocked.example.com' },
      }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('also omits Allow-Origin on regular responses when resolver returns empty', async () => {
    const server = createServer({
      cors: { origin: () => '' },
      routes: {
        'GET /api/v1/x': () => ({ json: { ok: true } }),
      },
    })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/x', {
        headers: { origin: 'https://blocked.example.com' },
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('sets Access-Control-Expose-Headers when configured', async () => {
    const server = createServer({
      cors: {
        origin: (o) => o,
        exposeHeaders: ['x-trace-id', 'x-request-id'],
      },
      routes: { 'GET /api/v1/x': () => ({ json: { ok: true } }) },
    })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/x', {
        headers: { origin: 'https://app.example.com' },
      }),
    )
    expect(res.headers.get('access-control-expose-headers')).toBe(
      'x-trace-id, x-request-id',
    )
  })

  it('intersects requested headers with cfg.allowHeaders when configured', async () => {
    // When the server declares an allowHeaders allowlist, the
    // preflight must drop any requested token that is not on the
    // list — otherwise the allowlist is decorative and the server
    // effectively permits anything the browser asks for.
    const server = createServer({
      cors: {
        origin: (o) => (o === '' ? '*' : o),
        allowHeaders: ['content-type', 'x-custom'],
      },
      routes: {},
    })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/anything', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://app.example.com',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type, x-evil, x-custom',
        },
      }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-headers')).toBe('content-type, x-custom')
  })

  it('falls back to cfg.allowHeaders when the request omits Access-Control-Request-Headers', async () => {
    const server = createServer({
      cors: {
        origin: (o) => (o === '' ? '*' : o),
        allowHeaders: ['content-type', 'x-only'],
      },
      routes: {},
    })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/anything', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://app.example.com',
          'access-control-request-method': 'POST',
        },
      }),
    )
    expect(res.headers.get('access-control-allow-headers')).toBe('content-type, x-only')
  })

  it('de-duplicates repeated tokens (case-insensitive) in the intersection', async () => {
    const server = createServer({
      cors: {
        origin: (o) => (o === '' ? '*' : o),
        allowHeaders: ['content-type', 'x-custom'],
      },
      routes: {},
    })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/anything', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://app.example.com',
          'access-control-request-method': 'POST',
          // Mixed-case duplicates + a blank token + an off-list header.
          'access-control-request-headers':
            'content-type, Content-Type, x-evil,  , X-Custom',
        },
      }),
    )
    // First occurrence wins, second copy is dropped, blank token
    // skipped, off-list `x-evil` rejected. Request casing is preserved.
    expect(res.headers.get('access-control-allow-headers')).toBe('content-type, X-Custom')
  })

  it('omits Access-Control-Allow-Headers entirely when allowHeaders is []', async () => {
    // Empty allowlist is a deliberate hard lockdown; emitting an
    // empty `access-control-allow-headers:` value is hostile, so the
    // header is dropped instead.
    const server = createServer({
      cors: {
        origin: (o) => (o === '' ? '*' : o),
        allowHeaders: [],
      },
      routes: {},
    })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/anything', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://app.example.com',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type, x-anything',
        },
      }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-headers')).toBeNull()
  })
})
