import { afterEach, describe, expect, it, vi } from 'vitest'

import { createServer, defineConfig } from '../src/index.js'
import { handleRuntimeServerError } from '../src/server.js'
import type {
  Config,
  ListenHandle,
  MockRequest,
  MockResponse,
} from '../src/index.js'

describe('defineConfig', () => {
  it('returns the same object', () => {
    const cfg = { routes: {} }
    expect(defineConfig(cfg)).toBe(cfg)
  })
})

describe('createServer', () => {
  it('returns 404 with a JSON envelope for an unmatched path', async () => {
    const server = createServer({ routes: {} })
    const res = await server.fetch(new Request('http://localhost/api/v1/nope'))
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    const body = await res.json()
    expect(body).toEqual({ error: 'not_found', method: 'get', path: '/api/v1/nope' })
  })

  it('dispatches a GET handler returning JSON', async () => {
    const server = createServer(
      defineConfig({
        routes: {
          'GET /api/v1/ping': () => ({ json: { ok: true } }),
        },
      }),
    )
    const res = await server.fetch(new Request('http://localhost/api/v1/ping'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('exposes query parameters via req.query', async () => {
    const server = createServer({
      routes: {
        'GET /api/v1/echo-q': ({ query }) => ({ json: query }),
      },
    })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/echo-q?master_group=Cargo&date_from=2024-04-01'),
    )
    expect(await res.json()).toEqual({ master_group: 'Cargo', date_from: '2024-04-01' })
  })

  it('exposes every value via req.queryAll for repeated keys', async () => {
    const server = createServer({
      routes: {
        'GET /api/v1/echo-q': ({ query, queryAll }) => ({ json: { query, queryAll } }),
      },
    })
    const res = await server.fetch(new Request('http://localhost/api/v1/echo-q?tag=a&tag=b&tag=c'))
    const body = (await res.json()) as { query: Record<string, string>; queryAll: Record<string, string[]> }
    expect(body.query).toEqual({ tag: 'c' })
    expect(body.queryAll).toEqual({ tag: ['a', 'b', 'c'] })
  })

  it('parses JSON request bodies via req.json()', async () => {
    const server = createServer({
      routes: {
        'POST /api/v1/echo': async ({ json }) => {
          const body = await json<{ value: number }>()
          return { json: { received: body.value * 2 } }
        },
      },
    })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/echo', {
        method: 'POST',
        body: JSON.stringify({ value: 21 }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(await res.json()).toEqual({ received: 42 })
  })

  it('shares one body read between json() and text() so handlers can call both', async () => {
    const server = createServer({
      routes: {
        'POST /api/v1/echo': async ({ json, text }) => {
          // text() first, then json() — second call must reuse cached body.
          const t = await text()
          const j = await json<{ v: number }>()
          // json() again to confirm the cache is re-readable.
          const j2 = await json<{ v: number }>()
          return { json: { t, j, j2 } }
        },
      },
    })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/echo', {
        method: 'POST',
        body: JSON.stringify({ v: 7 }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(await res.json()).toEqual({
      t: '{"v":7}',
      j: { v: 7 },
      j2: { v: 7 },
    })
  })

  it('honours status override', async () => {
    const server = createServer({
      routes: {
        'POST /api/v1/create': () => ({ json: { id: 1 }, status: 201 }),
      },
    })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/create', { method: 'POST' }),
    )
    expect(res.status).toBe(201)
  })

  it('supports text / empty body variants', async () => {
    const server = createServer({
      routes: {
        'GET /api/v1/txt': () => ({ text: 'hello' }),
        'DELETE /api/v1/x': () => ({ empty: true, status: 204 }),
      },
    })
    const txt = await server.fetch(new Request('http://localhost/api/v1/txt'))
    expect(txt.headers.get('content-type')).toMatch(/text\/plain/)
    expect(await txt.text()).toBe('hello')

    const del = await server.fetch(
      new Request('http://localhost/api/v1/x', { method: 'DELETE' }),
    )
    expect(del.status).toBe(204)
    expect(await del.text()).toBe('')
  })

  it('merges user headers over body-derived defaults', async () => {
    const server = createServer({
      routes: {
        'GET /api/v1/h': () => ({
          json: { ok: true },
          headers: { 'x-mock-mode': 'normal', 'content-type': 'application/vnd.foo+json' },
        }),
      },
    })
    const res = await server.fetch(new Request('http://localhost/api/v1/h'))
    expect(res.headers.get('x-mock-mode')).toBe('normal')
    expect(res.headers.get('content-type')).toBe('application/vnd.foo+json')
  })

  it('throws at construction on duplicate dispatch keys', () => {
    // Two route keys collapse to the same `method path` after parsing
    // (trailing whitespace is trimmed from the path). Build the routes
    // map via `Object.fromEntries` so both keys survive — an object
    // literal would silently dedupe them.
    const routes = Object.fromEntries([
      ['GET /api/v1/dup', () => ({ json: 1 })],
      ['GET /api/v1/dup ', () => ({ json: 2 })],
    ]) as NonNullable<Config['routes']>
    expect(() => createServer({ routes })).toThrow(/duplicate route/)
  })

  it('awaits async handlers', async () => {
    const server = createServer({
      routes: {
        'GET /api/v1/slow': async () => {
          await new Promise((r) => setTimeout(r, 5))
          return { json: { tick: 'done' } }
        },
      },
    })
    const res = await server.fetch(new Request('http://localhost/api/v1/slow'))
    expect(await res.json()).toEqual({ tick: 'done' })
  })
})

describe('createServer (dynamic routes)', () => {
  it('matches a :param and exposes it via req.params', async () => {
    const server = createServer({
      routes: {
        'GET /users/:id': ({ params }) => ({ json: { id: params.id } }),
      },
    })
    const res = await server.fetch(new Request('http://localhost/users/42'))
    expect(await res.json()).toEqual({ id: '42' })
  })

  it('prefers a static route over a dynamic one with the same shape', async () => {
    // Declaration order is irrelevant — the static index wins on hit.
    const server = createServer({
      routes: {
        'GET /users/:id': () => ({ json: { kind: 'dynamic' } }),
        'GET /users/me': () => ({ json: { kind: 'static' } }),
      },
    })
    const stat = await server.fetch(new Request('http://localhost/users/me'))
    expect(await stat.json()).toEqual({ kind: 'static' })
    const dyn = await server.fetch(new Request('http://localhost/users/42'))
    expect(await dyn.json()).toEqual({ kind: 'dynamic' })
  })

  it('captures multiple :params in order', async () => {
    const server = createServer({
      routes: {
        'GET /orgs/:org/repos/:repo': ({ params }) => ({
          json: { org: params.org, repo: params.repo },
        }),
      },
    })
    const res = await server.fetch(new Request('http://localhost/orgs/acme/repos/example'))
    expect(await res.json()).toEqual({ org: 'acme', repo: 'example' })
  })

  it('does not cross-match between methods', async () => {
    const server = createServer({
      routes: {
        'GET /users/:id': ({ params }) => ({ json: { method: 'get', id: params.id } }),
      },
    })
    const res = await server.fetch(
      new Request('http://localhost/users/1', { method: 'POST' }),
    )
    expect(res.status).toBe(404)
  })

  it('URL-decodes params end-to-end', async () => {
    const server = createServer({
      routes: {
        'GET /items/:name': ({ params }) => ({ json: params }),
      },
    })
    const res = await server.fetch(new Request('http://localhost/items/%C3%A9'))
    expect(await res.json()).toEqual({ name: 'é' })
  })

  it('serves html / raw body variants and 500s when no body variant is set', async () => {
    const server = createServer({
      routes: {
        'GET /html': () => ({ html: '<h1>hi</h1>' }),
        'GET /raw': () => ({ raw: new Uint8Array([1, 2, 3]) }),
        // Empty object is not a valid `MockResponse` body variant — cast through
        // unknown to exercise the runtime guard in `buildResponse`.
        'GET /missing': () => ({}) as unknown as MockResponse,
      },
    })

    const h = await server.fetch(new Request('http://localhost/html'))
    expect(h.headers.get('content-type')).toMatch(/text\/html/)
    expect(await h.text()).toBe('<h1>hi</h1>')

    const r = await server.fetch(new Request('http://localhost/raw'))
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))

    const m = await server.fetch(new Request('http://localhost/missing'))
    expect(m.status).toBe(500)
    const body = (await m.json()) as { error: string; message: string }
    expect(body.error).toBe('internal_error')
    expect(body.message).toMatch(/body variant missing/)
  })

  it('auto-serves HEAD by running the GET handler and stripping the body (RFC 7231)', async () => {
    const server = createServer({
      routes: {
        'GET /api/v1/x': () => ({ json: { ok: true, n: 42 } }),
      },
    })
    const get = await server.fetch(new Request('http://localhost/api/v1/x'))
    const head = await server.fetch(
      new Request('http://localhost/api/v1/x', { method: 'HEAD' }),
    )
    expect(head.status).toBe(get.status)
    expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'))
    // No body on HEAD.
    expect(await head.text()).toBe('')
  })

  it('HEAD for an unknown path still 404s', async () => {
    const server = createServer({
      routes: { 'GET /api/v1/x': () => ({ json: { ok: true } }) },
    })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/missing', { method: 'HEAD' }),
    )
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('')
  })
})

describe('hooks.onRequest', () => {
  it('short-circuits the handler when it returns a response', async () => {
    let handlerCalled = false
    const server = createServer({
      hooks: {
        onRequest: () => ({ json: { intercepted: true }, status: 418 }),
      },
      routes: {
        'GET /api/v1/foo': () => {
          handlerCalled = true
          return { json: { ok: true } }
        },
      },
    })
    const res = await server.fetch(new Request('http://localhost/api/v1/foo'))
    expect(res.status).toBe(418)
    expect(await res.json()).toEqual({ intercepted: true })
    expect(handlerCalled).toBe(false)
  })

  it('passes through when it returns void', async () => {
    const seen: Array<{ method: string; path: string }> = []
    const server = createServer({
      hooks: {
        onRequest: (req: MockRequest) => {
          seen.push({ method: req.method, path: req.path })
        },
      },
      routes: {
        'GET /api/v1/foo': () => ({ json: { ok: true } }),
      },
    })
    const res = await server.fetch(new Request('http://localhost/api/v1/foo'))
    expect(await res.json()).toEqual({ ok: true })
    expect(seen).toEqual([{ method: 'get', path: '/api/v1/foo' }])
  })
})

describe('hooks.onResponse', () => {
  it('can replace the handler response', async () => {
    const server = createServer({
      hooks: {
        onResponse: (_req: MockRequest, res: MockResponse) =>
          ({ ...res, headers: { 'x-tag': 'hi' } }) satisfies MockResponse,
      },
      routes: {
        'GET /api/v1/foo': () => ({ json: { ok: true } }),
      },
    })
    const res = await server.fetch(new Request('http://localhost/api/v1/foo'))
    expect(res.headers.get('x-tag')).toBe('hi')
    expect(await res.json()).toEqual({ ok: true })
  })

  it('runs even for 404 responses', async () => {
    let saw404 = false
    const server = createServer({
      hooks: {
        onResponse: (_req, res) => {
          if (res.status === 404) saw404 = true
          return res
        },
      },
    })
    const res = await server.fetch(new Request('http://localhost/missing'))
    expect(res.status).toBe(404)
    expect(saw404).toBe(true)
  })
})

describe('hooks.onError', () => {
  it('catches handler throws and lets the hook craft the response', async () => {
    const server = createServer({
      hooks: {
        onError: (_req, err) => ({
          status: 502,
          json: { caught: (err as Error).message },
        }),
      },
      routes: {
        'GET /api/v1/boom': () => {
          throw new Error('kaboom')
        },
      },
    })
    const res = await server.fetch(new Request('http://localhost/api/v1/boom'))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ caught: 'kaboom' })
  })

  it('falls back to a 500 envelope when no hook is configured', async () => {
    const server = createServer({
      routes: {
        'GET /api/v1/boom': () => {
          throw new Error('kaboom')
        },
      },
    })
    const res = await server.fetch(new Request('http://localhost/api/v1/boom'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal_error', message: 'kaboom' })
  })
})

/**
 * `server.listen` integration: bind a real Node HTTP server on an
 * OS-assigned port (`port: 0`), hit it through the runtime `fetch`,
 * then shut down. Previously lived in `listen.test.ts`; merged here
 * because `listen` is a method on `server.ts`, not its own module.
 */
describe('createServer.listen', () => {
  let handle: ListenHandle | null = null

  afterEach(async () => {
    if (handle) {
      await handle.close()
      handle = null
    }
  })

  it('binds to an OS-assigned port and serves a real HTTP request', async () => {
    const server = createServer({
      routes: {
        'GET /api/v1/ping': () => ({ json: { ok: true } }),
        'GET /users/:id': ({ params }) => ({ json: { id: params.id } }),
      },
    })
    handle = await server.listen({ port: 0 })

    expect(handle.port).toBeGreaterThan(0)
    expect(handle.host).toBe('127.0.0.1')

    const ping = await fetch(`http://127.0.0.1:${handle.port}/api/v1/ping`)
    expect(ping.status).toBe(200)
    expect(await ping.json()).toEqual({ ok: true })

    const user = await fetch(`http://127.0.0.1:${handle.port}/users/42`)
    expect(await user.json()).toEqual({ id: '42' })

    const miss = await fetch(`http://127.0.0.1:${handle.port}/nope`)
    expect(miss.status).toBe(404)
  })

  it('forwards POST bodies to req.json()', async () => {
    const server = createServer({
      routes: {
        'POST /api/v1/echo': async ({ json }) => {
          const body = await json<{ value: number }>()
          return { json: { received: body.value * 2 } }
        },
      },
    })
    handle = await server.listen({ port: 0 })

    const res = await fetch(`http://127.0.0.1:${handle.port}/api/v1/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 21 }),
    })
    expect(await res.json()).toEqual({ received: 42 })
  })

  it('close() releases the port', async () => {
    const server = createServer({ routes: {} })
    const h = await server.listen({ port: 0 })
    const portBefore = h.port
    await h.close()

    // Re-binding to the same explicit port should now succeed.
    handle = await server.listen({ port: portBefore })
    expect(handle.port).toBe(portBefore)
  })

  it('accepts `hooks.onServerError` and binds successfully', async () => {
    // Behavioural integration: a runtime `'error'` on the underlying
    // Node `http.Server` is hard to provoke cleanly without leaking a
    // socket. We assert the contract that the option is accepted and
    // the server still binds, then exercise the dispatch path
    // separately via a regular request. Coverage of the hook branch
    // is provided by the unit test in `loader`/`json-config` tiers
    // when wired through config; here we only guard the typing and
    // listen path don't reject a hook.
    const onServerError = vi.fn((_err: Error) => {})
    const server = createServer({
      routes: { 'GET /api/v1/ok': () => ({ json: { ok: true } }) },
      hooks: { onServerError },
    })
    handle = await server.listen({ port: 0 })
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/v1/ok`)
    expect(res.status).toBe(200)
    // Hook must never fire on a normal request lifecycle.
    expect(onServerError).not.toHaveBeenCalled()
  })
})

describe('handleRuntimeServerError', () => {
  // The helper is the unit-testable seam for the `server.on('error', ...)`
  // branch registered after a successful bind. Exercising the three paths
  // here keeps `server.ts` coverage stable without spinning up real
  // sockets and trying to provoke EMFILE / EACCES from inside a test.

  it('logs via console.error when no hook is supplied', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      handleRuntimeServerError(new Error('boom'), undefined)
      expect(err).toHaveBeenCalledTimes(1)
      expect(String(err.mock.calls[0]![0])).toMatch(/server error/)
    } finally {
      err.mockRestore()
    }
  })

  it('invokes the user-supplied hook and suppresses the default log', () => {
    const hook = vi.fn((_err: Error) => {})
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      handleRuntimeServerError(new Error('boom'), hook)
      expect(hook).toHaveBeenCalledTimes(1)
      expect(err).not.toHaveBeenCalled()
    } finally {
      err.mockRestore()
    }
  })

  it('falls back to console.error AND logs the hook failure when the hook throws', () => {
    const hook = vi.fn((_err: Error) => {
      throw new Error('hook-blew-up')
    })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      handleRuntimeServerError(new Error('boom'), hook)
      expect(hook).toHaveBeenCalledTimes(1)
      // First the hook failure, then the original error — never the
      // other way around (the user should see *their* bug surfaced
      // distinctly from the underlying server fault).
      expect(err).toHaveBeenCalledTimes(2)
      expect(String(err.mock.calls[0]![0])).toMatch(/onServerError hook threw/)
      expect(String(err.mock.calls[1]![0])).toMatch(/server error/)
    } finally {
      err.mockRestore()
    }
  })
})
