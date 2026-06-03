import { describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'

import {
  createInjectHook,
  resolveMode,
  isDestroySocketSentinel,
} from '../../src/admin/inject.js'
import { createOverridesStore } from '../../src/admin/overrides-store.js'
import type { MockRequest } from '../../src/index.js'

const fakeReq = (
  method: string,
  path: string,
  headers: Record<string, string> = {}
): MockRequest => ({
  method: method.toLowerCase() as MockRequest['method'],
  url: `http://x${path}`,
  path,
  query: {},
  queryAll: {},
  params: {},
  headers,
  json: async <T = unknown>(): Promise<T> => ({} as T),
  text: async () => '',
  raw: () => new Request('http://x' + path),
})

describe('inject onRequest hook', () => {
  it('passes through default /databehave paths', async () => {
    const store = createOverridesStore({ warn: vi.fn() })
    store.add({
      matcher: { kind: 'global' },
      mode: { kind: 'http-status', status: 500 },
    })
    const hook = createInjectHook({ store })
    expect(await hook(fakeReq('GET', '/databehave'))).toBeUndefined()
    expect(await hook(fakeReq('GET', '/databehave/overrides'))).toBeUndefined()
  })

  it('returns http-status response for header', async () => {
    const hook = createInjectHook({
      store: createOverridesStore({ warn: vi.fn() }),
    })
    const r = await hook(fakeReq('GET', '/api/x', { 'x-mock-status': '500' }))
    expect(r?.status).toBe(500)
    expect(r?.headers?.['x-mock-injected']).toContain('http-status:header')
  })

  it('returns business-failure as 200 + {success:false, message}', async () => {
    const hook = createInjectHook({
      store: createOverridesStore({ warn: vi.fn() }),
    })
    const r = await hook(
      fakeReq('POST', '/api/x', { 'x-mock-business-failure': 'oops' })
    )
    expect(r?.status).toBe(200)
    expect((r as { json: unknown }).json).toEqual({
      success: false,
      message: 'oops',
    })
  })

  it('business-failure merges extra fields', async () => {
    const extra = Buffer.from(JSON.stringify({ code: 'E1' })).toString('base64')
    const hook = createInjectHook({
      store: createOverridesStore({ warn: vi.fn() }),
    })
    const r = await hook(
      fakeReq('POST', '/api/x', {
        'x-mock-business-failure': 'm',
        'x-mock-business-failure-extra': extra,
      })
    )
    expect((r as { json: { code: string } }).json.code).toBe('E1')
  })

  it('malformed-json returns raw "{"', async () => {
    const hook = createInjectHook({
      store: createOverridesStore({ warn: vi.fn() }),
    })
    const r = await hook(fakeReq('GET', '/api/x', { 'x-mock-malformed': '1' }))
    expect((r as { raw: string }).raw).toBe('{')
  })

  it('empty-body returns empty:true with default 204', async () => {
    const hook = createInjectHook({
      store: createOverridesStore({ warn: vi.fn() }),
    })
    const r = await hook(fakeReq('GET', '/api/x', { 'x-mock-empty': '1' }))
    expect(r?.status).toBe(204)
    expect((r as { empty: boolean }).empty).toBe(true)
  })

  it('header beats sticky', async () => {
    const store = createOverridesStore({ warn: vi.fn() })
    store.add({
      matcher: { kind: 'global' },
      mode: { kind: 'http-status', status: 503 },
    })
    const hook = createInjectHook({ store })
    const r = await hook(fakeReq('GET', '/api/x', { 'x-mock-status': '500' }))
    expect(r?.status).toBe(500)
    expect(r?.headers?.['x-mock-injected']).toContain('header')
  })

  it('sticky kicks in when no header set', async () => {
    const store = createOverridesStore({ warn: vi.fn() })
    store.add({
      matcher: { kind: 'exact', method: 'GET', path: '/api/x' },
      mode: { kind: 'business-failure', message: 'sticky' },
    })
    const hook = createInjectHook({ store })
    const r = await hook(fakeReq('GET', '/api/x'))
    expect((r as { json: { message: string } }).json.message).toBe('sticky')
    expect(r?.headers?.['x-mock-injected']).toContain('sticky')
  })

  it('returns 400 on malformed header', async () => {
    const hook = createInjectHook({
      store: createOverridesStore({ warn: vi.fn() }),
    })
    const r = await hook(fakeReq('GET', '/api/x', { 'x-mock-status': 'NaN' }))
    expect(r?.status).toBe(400)
  })

  it('delay sleeps then runs pass-through (no then)', async () => {
    const hook = createInjectHook({
      store: createOverridesStore({ warn: vi.fn() }),
    })
    const t0 = Date.now()
    const r = await hook(fakeReq('GET', '/api/x', { 'x-mock-delay': '50' }))
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45)
    expect(r).toBeUndefined()
  })

  it('delay wrapping http-status returns the inner mode after sleeping', async () => {
    const hook = createInjectHook({
      store: createOverridesStore({ warn: vi.fn() }),
    })
    const r = await hook(
      fakeReq('GET', '/api/x', { 'x-mock-delay': '20', 'x-mock-status': '503' })
    )
    expect(r?.status).toBe(503)
  })
})

describe('resolveMode + destroy sentinel', () => {
  it('resolveMode source distinguishes header vs sticky', () => {
    const store = createOverridesStore({ warn: vi.fn() })
    store.add({
      matcher: { kind: 'global' },
      mode: { kind: 'http-status', status: 500 },
    })
    expect(resolveMode(store, 'GET', '/x', {}).kind).toBe('mode')
    expect(resolveMode(store, 'GET', '/x', {})).toMatchObject({
      source: 'sticky',
    })
    expect(
      resolveMode(store, 'GET', '/x', { 'x-mock-status': '503' })
    ).toMatchObject({ source: 'header' })
  })

  it('destroy header → sentinel response (allowDestroy default true)', async () => {
    const hook = createInjectHook({
      store: createOverridesStore({ warn: vi.fn() }),
    })
    const r = (await hook(fakeReq('GET', '/api/x', { 'x-mock-destroy': '1' }))) ?? undefined
    expect(isDestroySocketSentinel(r)).toBe(true)
  })

  it('destroy header + allowDestroy:false → 503 response', async () => {
    const hook = createInjectHook({
      store: createOverridesStore({ warn: vi.fn() }),
      allowDestroy: false,
      logger: { warn: vi.fn() },
    })
    const r = (await hook(fakeReq('GET', '/api/x', { 'x-mock-destroy': '1' }))) ?? undefined
    expect(r?.status).toBe(503)
    expect(isDestroySocketSentinel(r)).toBe(false)
  })

  it('isDestroySocketSentinel false for plain responses + undefined', () => {
    expect(isDestroySocketSentinel(undefined)).toBe(false)
    expect(isDestroySocketSentinel(null)).toBe(false)
    expect(isDestroySocketSentinel({ status: 200, empty: true })).toBe(false)
  })

  it('bypassPathPrefixes overrideable', async () => {
    const store = createOverridesStore({ warn: vi.fn() })
    store.add({
      matcher: { kind: 'global' },
      mode: { kind: 'http-status', status: 500 },
    })
    const hook = createInjectHook({
      store,
      bypassPathPrefixes: ['/admin/'],
    })
    expect(await hook(fakeReq('GET', '/admin/x'))).toBeUndefined()
    expect(await hook(fakeReq('GET', '/_mock/x'))).toBeDefined()
  })
})
