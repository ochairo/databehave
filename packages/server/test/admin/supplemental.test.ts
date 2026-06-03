import { describe, expect, it } from 'vitest'

import {
  composeAdminOnRequest,
  createServer,
  resolveAdminMode,
} from '../../src/server.js'
import { createAdminRoutes } from '../../src/admin/admin-routes.js'
import { createInjectHook } from '../../src/admin/inject.js'
import { createOverridesStore } from '../../src/admin/overrides-store.js'

describe('resolveAdminMode', () => {
  it('returns null when undefined', () => {
    expect(resolveAdminMode(undefined)).toBeNull()
  })
  it('returns null when enabled:false', () => {
    expect(resolveAdminMode({ enabled: false })).toBeNull()
  })
  it('defaults are applied when enabled', () => {
    const r = resolveAdminMode({ enabled: true })
    expect(r).toMatchObject({
      path: '/databehave',
      ui: true,
      headers: true,
      bind: 'loopback-only',
      cors: 'auto',
      allowDestroy: true,
    })
  })
  it('throws when path missing leading slash', () => {
    expect(() => resolveAdminMode({ enabled: true, path: 'bad' })).toThrow(
      /must start with/,
    )
  })
})

describe('composeAdminOnRequest', () => {
  const req = { method: 'GET', path: '/x' } as never
  it('returns admin when no user hook', async () => {
    const admin = async () => ({ status: 200, json: { a: 1 } })
    const fn = composeAdminOnRequest(undefined, admin)
    expect(await fn(req)).toEqual({ status: 200, json: { a: 1 } })
  })
  it('user-first: if user returns a response, admin is skipped', async () => {
    let adminCalls = 0
    const admin = async () => {
      adminCalls++
      return { status: 200, json: { admin: true } }
    }
    const fn = composeAdminOnRequest(
      () => ({ status: 418, json: { user: true } }),
      admin,
    )
    expect(await fn(req)).toEqual({ status: 418, json: { user: true } })
    expect(adminCalls).toBe(0)
  })
  it('user-first: if user returns void, admin runs', async () => {
    const fn = composeAdminOnRequest(
      () => undefined,
      async () => ({ status: 200, json: { admin: true } }),
    )
    expect(await fn(req)).toEqual({ status: 200, json: { admin: true } })
  })
})

describe('admin-routes supplemental', () => {
  it('accepts path matcher', async () => {
    const store = createOverridesStore({ warn: () => {} })
    const server = createServer({
      routes: createAdminRoutes({ store, basePath: '/_mock' }),
    })
    const res = await server.fetch(
      new Request('http://x/_mock/overrides', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          matcher: { kind: 'path', path: '/api/v1/x' },
          mode: { kind: 'http-status', status: 503 },
        }),
      }),
    )
    expect(res.status).toBe(201)
  })
  it('accepts global matcher (no extras)', async () => {
    const store = createOverridesStore({ warn: () => {} })
    const server = createServer({
      routes: createAdminRoutes({ store, basePath: '/_mock' }),
    })
    const res = await server.fetch(
      new Request('http://x/_mock/overrides', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          matcher: { kind: 'global' },
          mode: { kind: 'http-status', status: 500 },
        }),
      }),
    )
    expect(res.status).toBe(201)
  })
  it('rejects unknown matcher.kind', async () => {
    const store = createOverridesStore({ warn: () => {} })
    const server = createServer({
      routes: createAdminRoutes({ store, basePath: '/_mock' }),
    })
    const res = await server.fetch(
      new Request('http://x/_mock/overrides', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          matcher: { kind: 'mystery' },
          mode: { kind: 'http-status', status: 500 },
        }),
      }),
    )
    expect(res.status).toBe(400)
  })
  it('exact matcher requires method + valid path', async () => {
    const store = createOverridesStore({ warn: () => {} })
    const server = createServer({
      routes: createAdminRoutes({ store, basePath: '/_mock' }),
    })
    const bad = await server.fetch(
      new Request('http://x/_mock/overrides', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          matcher: { kind: 'exact', path: 'no-slash', method: 'GET' },
          mode: { kind: 'http-status', status: 500 },
        }),
      }),
    )
    expect(bad.status).toBe(400)
  })
})

describe('inject supplemental', () => {
  it('hang mode warns and never resolves (race observes timeout)', async () => {
    const store = createOverridesStore({ warn: () => {} })
    const warn = (() => {
      let captured = ''
      const fn = (msg: string) => {
        captured += msg
      }
      ;(fn as unknown as { captured: () => string }).captured = () => captured
      return fn as unknown as ((msg: string) => void) & { captured: () => string }
    })()
    const hook = createInjectHook({ store, logger: { warn } })
    const winner = await Promise.race([
      hook({
        method: 'GET',
        path: '/x',
        headers: { 'x-mock-hang': '1' },
      } as never),
      new Promise((r) => setTimeout(() => r('TIMEOUT'), 30)),
    ])
    expect(winner).toBe('TIMEOUT')
    expect(warn.captured()).toContain('hang triggered')
  })
  it('bypassPathPrefixes skips inject for matching paths', async () => {
    const store = createOverridesStore({ warn: () => {} })
    store.add({
      matcher: { kind: 'global' },
      mode: { kind: 'http-status', status: 500 },
    })
    const hook = createInjectHook({
      store,
      bypassPathPrefixes: ['/_mock'],
      logger: { warn: () => {} },
    })
    const res = await hook({
      method: 'GET',
      path: '/_mock/overrides',
      headers: {},
    } as never)
    expect(res).toBeUndefined()
  })
  it('returns 400 when header parser reports error', async () => {
    const store = createOverridesStore({ warn: () => {} })
    const hook = createInjectHook({ store, logger: { warn: () => {} } })
    const res = await hook({
      method: 'GET',
      path: '/x',
      headers: { 'x-mock-status': 'abc' },
    } as never)
    expect(res).toBeDefined()
    expect((res as { status: number }).status).toBe(400)
  })
  it('delay then nothing → undefined', async () => {
    const store = createOverridesStore({ warn: () => {} })
    store.add({
      matcher: { kind: 'global' },
      mode: { kind: 'delay', ms: 1 },
    })
    const hook = createInjectHook({ store, logger: { warn: () => {} } })
    const res = await hook({ method: 'GET', path: '/x', headers: {} } as never)
    expect(res).toBeUndefined()
  })
  it('delay then http-status → injected', async () => {
    const store = createOverridesStore({ warn: () => {} })
    store.add({
      matcher: { kind: 'global' },
      mode: { kind: 'delay', ms: 1, then: { kind: 'http-status', status: 502 } },
    })
    const hook = createInjectHook({ store, logger: { warn: () => {} } })
    const res = await hook({ method: 'GET', path: '/x', headers: {} } as never)
    expect((res as { status: number }).status).toBe(502)
  })
  it('custom-body string with non-json contentType → text branch', async () => {
    const store = createOverridesStore({ warn: () => {} })
    store.add({
      matcher: { kind: 'global' },
      mode: { kind: 'custom-body', body: 'hello', contentType: 'text/plain' },
    })
    const hook = createInjectHook({ store, logger: { warn: () => {} } })
    const res = (await hook({
      method: 'GET',
      path: '/x',
      headers: {},
    } as never)) as { text: string; headers: Record<string, string> }
    expect(res.text).toBe('hello')
    expect(res.headers['content-type']).toBe('text/plain')
  })
  it('empty-body mode → status with empty:true', async () => {
    const store = createOverridesStore({ warn: () => {} })
    store.add({
      matcher: { kind: 'global' },
      mode: { kind: 'empty-body', status: 204 },
    })
    const hook = createInjectHook({ store, logger: { warn: () => {} } })
    const res = (await hook({
      method: 'GET',
      path: '/x',
      headers: {},
    } as never)) as { status: number; empty: boolean }
    expect(res.status).toBe(204)
    expect(res.empty).toBe(true)
  })
  it('malformed-json mode → raw "{" body', async () => {
    const store = createOverridesStore({ warn: () => {} })
    store.add({
      matcher: { kind: 'global' },
      mode: { kind: 'malformed-json' },
    })
    const hook = createInjectHook({ store, logger: { warn: () => {} } })
    const res = (await hook({
      method: 'GET',
      path: '/x',
      headers: {},
    } as never)) as { raw: string }
    expect(res.raw).toBe('{')
  })
})
