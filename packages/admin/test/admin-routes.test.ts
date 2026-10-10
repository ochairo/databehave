import { describe, expect, it } from 'vitest'

import { createHttpFixture } from './http-fixture.js'
import { createAdminRoutes } from '../src/admin-routes.js'
import { createInjectHook } from '../src/inject.js'
import { createOverridesStore } from '../src/overrides-store.js'

const buildServer = () => {
  const store = createOverridesStore({ warn: () => {} })
  const routes = createAdminRoutes({
    store,
    basePath: '/_mock',
    corsHeaders: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  })
  const server = createHttpFixture({
    routes,
    hooks: {
      onRequest: createInjectHook({
        store,
        bypassPathPrefixes: ['/_mock'],
        logger: { warn: () => {} },
      }),
    },
  })
  return { server, store }
}

describe('admin REST routes', () => {
  it('GET /_mock/overrides returns empty list initially', async () => {
    const { server } = buildServer()
    const res = await server.fetch(new Request('http://x/_mock/overrides'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ overrides: [] })
  })

  it('POST /_mock/overrides creates a sticky and returns 201', async () => {
    const { server, store } = buildServer()
    const res = await server.fetch(
      new Request('http://x/_mock/overrides', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          matcher: { kind: 'exact', method: 'GET', path: '/api/v1/health' },
          mode: { kind: 'http-status', status: 503 },
          description: 'test',
        }),
      }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      id: string
      override: { description: string }
    }
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.override.description).toBe('test')
    expect(store.list()).toHaveLength(1)
  })

  it('POST rejects invalid matcher / mode with 400', async () => {
    const { server } = buildServer()
    const res = await server.fetch(
      new Request('http://x/_mock/overrides', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          matcher: { kind: 'oops' },
          mode: { kind: 'http-status', status: 500 },
        }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('POST rejects non-object body / invalid JSON / bad mode shape', async () => {
    const { server } = buildServer()
    const r1 = await server.fetch(
      new Request('http://x/_mock/overrides', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '"not-an-object"',
      }),
    )
    expect(r1.status).toBe(400)
    const r2 = await server.fetch(
      new Request('http://x/_mock/overrides', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json{',
      }),
    )
    expect(r2.status).toBe(400)
    const r3 = await server.fetch(
      new Request('http://x/_mock/overrides', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          matcher: { kind: 'global' },
          mode: { kind: 'http-status', status: 'NaN' },
        }),
      }),
    )
    expect(r3.status).toBe(400)
  })

  it('accepts every mode kind (smoke through validator)', async () => {
    const { server } = buildServer()
    const modes = [
      { kind: 'http-status', status: 500 },
      { kind: 'business-failure', message: 'm', extra: { code: 'X' } },
      { kind: 'custom-body', body: { a: 1 }, status: 200, contentType: 'application/json' },
      { kind: 'empty-body', status: 204 },
      { kind: 'malformed-json', status: 200 },
      { kind: 'delay', ms: 10, then: { kind: 'http-status', status: 500 } },
      { kind: 'hang' },
      { kind: 'destroy' },
    ]
    for (const mode of modes) {
      const res = await server.fetch(
        new Request('http://x/_mock/overrides', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ matcher: { kind: 'global' }, mode }),
        }),
      )
      expect(res.status, JSON.stringify(mode)).toBe(201)
    }
  })

  it('rejects delay wrapping destroy / hang', async () => {
    const { server } = buildServer()
    for (const inner of [{ kind: 'destroy' }, { kind: 'hang' }]) {
      const res = await server.fetch(
        new Request('http://x/_mock/overrides', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            matcher: { kind: 'global' },
            mode: { kind: 'delay', ms: 1, then: inner },
          }),
        }),
      )
      expect(res.status).toBe(400)
    }
  })

  it('DELETE /_mock/overrides/:id 404 when unknown, 200 + removes when present', async () => {
    const { server, store } = buildServer()
    const r1 = await server.fetch(
      new Request('http://x/_mock/overrides/nope', { method: 'DELETE' }),
    )
    expect(r1.status).toBe(404)
    const o = store.add({
      matcher: { kind: 'global' },
      mode: { kind: 'http-status', status: 500 },
    })
    const r2 = await server.fetch(
      new Request(`http://x/_mock/overrides/${o.id}`, { method: 'DELETE' }),
    )
    expect(r2.status).toBe(200)
    expect(store.list()).toHaveLength(0)
  })

  it('DELETE /_mock/overrides clears all', async () => {
    const { server, store } = buildServer()
    store.add({ matcher: { kind: 'global' }, mode: { kind: 'http-status', status: 500 } })
    store.add({ matcher: { kind: 'global' }, mode: { kind: 'http-status', status: 503 } })
    const res = await server.fetch(
      new Request('http://x/_mock/overrides', { method: 'DELETE' }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ cleared: 2 })
    expect(store.list()).toHaveLength(0)
  })

  it('GET /_mock/openapi.json returns the raw document when configured', async () => {
    const openapiBody = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: { '/api/v1/health': { get: { summary: 'health' } } },
    })
    const store = createOverridesStore({ warn: () => {} })
    const server = createHttpFixture({
      routes: createAdminRoutes({ store, basePath: '/_mock', openapiBody: () => openapiBody }),
    })
    const res = await server.fetch(new Request('http://x/_mock/openapi.json'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const text = await res.text()
    expect(text).toBe(openapiBody)
    expect(JSON.parse(text)).toMatchObject({ openapi: '3.0.0' })
  })

  it('GET /_mock/openapi.json returns 404 when openapiBody is not configured', async () => {
    const store = createOverridesStore({ warn: () => {} })
    const server = createHttpFixture({
      routes: createAdminRoutes({ store, basePath: '/_mock' }),
    })
    const res = await server.fetch(new Request('http://x/_mock/openapi.json'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'no openapi document configured' })
  })

  it('GET /_mock serves the HTML page (UI at base path itself)', async () => {
    const { server } = buildServer()
    const res = await server.fetch(new Request('http://x/_mock'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    const text = await res.text()
    expect(text).toContain('Mock Injection')
  })

  it('GET /_mock/ trailing-slash variant also serves HTML', async () => {
    const { server } = buildServer()
    const res = await server.fetch(new Request('http://x/_mock/'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
  })

  it('GET /_mock/ui is gone (404 — UI served at base path itself)', async () => {
    const { server } = buildServer()
    const res = await server.fetch(new Request('http://x/_mock/ui'))
    expect(res.status).toBe(404)
  })

  it('HTML body is templated with the resolved basePath', async () => {
    const store = createOverridesStore({ warn: () => {} })
    const server = createHttpFixture({
      routes: createAdminRoutes({ store, basePath: '/foo' }),
    })
    const res = await server.fetch(new Request('http://x/foo'))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('src="/foo/ui.js"')
    expect(text).toContain('href="/foo/ui.css"')
    expect(text).toContain('window.__DATABEHAVE_BASE__="/foo"')
    expect(text).not.toContain('__DATABEHAVE_BASE__/ui.js')
  })

  it('ui:false omits the UI route', async () => {
    const store = createOverridesStore({ warn: () => {} })
    const server = createHttpFixture({
      routes: createAdminRoutes({ store, basePath: '/_mock', ui: false }),
    })
    const res = await server.fetch(new Request('http://x/_mock'))
    expect(res.status).toBe(404)
  })

  // The following three tests require `dist/admin/ui.{js,css}` to exist
  // on disk. Run `pnpm run build:admin` before `pnpm test` (the server's
  // `pnpm run build` script chains build:admin → tsc, so a fresh build
  // satisfies this prerequisite).
  it('GET /_mock/ui.js serves the script bundle', async () => {
    const { server } = buildServer()
    const res = await server.fetch(new Request('http://x/_mock/ui.js'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe(
      'application/javascript; charset=utf-8',
    )
    const body = await res.text()
    expect(body.length).toBeGreaterThan(100)
  })

  it('GET /_mock/ui.css serves the stylesheet', async () => {
    const { server } = buildServer()
    const res = await server.fetch(new Request('http://x/_mock/ui.css'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/css; charset=utf-8')
    const body = await res.text()
    expect(body.length).toBeGreaterThan(100)
  })

  it('ui:false omits the ui.js and ui.css asset routes', async () => {
    const store = createOverridesStore({ warn: () => {} })
    const server = createHttpFixture({
      routes: createAdminRoutes({ store, basePath: '/_mock', ui: false }),
    })
    const resJs = await server.fetch(new Request('http://x/_mock/ui.js'))
    expect(resJs.status).toBe(404)
    const resCss = await server.fetch(new Request('http://x/_mock/ui.css'))
    expect(resCss.status).toBe(404)
  })

  it('rejects basePath without leading slash', () => {
    const store = createOverridesStore({ warn: () => {} })
    expect(() => createAdminRoutes({ store, basePath: 'bad' })).toThrow(/must start with/)
  })

  it('respects custom basePath', async () => {
    const store = createOverridesStore({ warn: () => {} })
    const server = createHttpFixture({
      routes: createAdminRoutes({ store, basePath: '/__admin' }),
    })
    const res = await server.fetch(new Request('http://x/__admin/overrides'))
    expect(res.status).toBe(200)
  })

  it('admin routes carry configured CORS headers', async () => {
    const { server } = buildServer()
    const res = await server.fetch(new Request('http://x/_mock/overrides'))
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})
