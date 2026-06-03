import { describe, expect, it, vi } from 'vitest'

import { createOverridesStore } from '../../src/admin/overrides-store.js'
import type { ErrorMode, StickyMatcher } from '../../src/admin/admin-types.js'

const httpStatus = (status: number): ErrorMode => ({
  kind: 'http-status',
  status,
})
const exact = (method: string, path: string): StickyMatcher => ({
  kind: 'exact',
  method,
  path,
})
const pathOnly = (p: string): StickyMatcher => ({ kind: 'path', path: p })
const globalM = (): StickyMatcher => ({ kind: 'global' })

describe('overrides-store add/remove/list/clear', () => {
  it('add returns an override with id and uppercases the matcher method', () => {
    const store = createOverridesStore({ warn: vi.fn() })
    const o = store.add({ matcher: exact('get', '/x'), mode: httpStatus(500) })
    expect(o.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(o.matcher).toEqual({ kind: 'exact', method: 'GET', path: '/x' })
  })

  it('list reflects insertion order', () => {
    const store = createOverridesStore({ warn: vi.fn() })
    const a = store.add({ matcher: globalM(), mode: httpStatus(500) })
    const b = store.add({ matcher: pathOnly('/y'), mode: httpStatus(503) })
    expect(store.list().map((o) => o.id)).toEqual([a.id, b.id])
  })

  it('remove by id returns boolean and removes from list', () => {
    const store = createOverridesStore({ warn: vi.fn() })
    const o = store.add({ matcher: globalM(), mode: httpStatus(500) })
    expect(store.remove('nope')).toBe(false)
    expect(store.remove(o.id)).toBe(true)
    expect(store.list()).toHaveLength(0)
  })

  it('clear returns count', () => {
    const store = createOverridesStore({ warn: vi.fn() })
    store.add({ matcher: globalM(), mode: httpStatus(500) })
    store.add({ matcher: globalM(), mode: httpStatus(503) })
    expect(store.clear()).toBe(2)
    expect(store.list()).toHaveLength(0)
  })
})

describe('overrides-store resolve priority', () => {
  it('exact wins over path wins over global', () => {
    const store = createOverridesStore({ warn: vi.fn() })
    store.add({ matcher: globalM(), mode: httpStatus(500) })
    store.add({ matcher: pathOnly('/api/x'), mode: httpStatus(503) })
    store.add({ matcher: exact('POST', '/api/x'), mode: httpStatus(409) })
    const hit = store.resolve('POST', '/api/x')
    expect(hit?.mode).toEqual(httpStatus(409))

    const hit2 = store.resolve('GET', '/api/x')
    expect(hit2?.mode).toEqual(httpStatus(503))

    const hit3 = store.resolve('GET', '/anywhere-else')
    expect(hit3?.mode).toEqual(httpStatus(500))
  })

  it('last-wins when two stickies match at the same level', () => {
    const warn = vi.fn()
    const store = createOverridesStore({ warn })
    store.add({ matcher: exact('GET', '/x'), mode: httpStatus(500) })
    store.add({ matcher: exact('GET', '/x'), mode: httpStatus(503) })
    expect(warn).toHaveBeenCalled()
    expect(store.resolve('GET', '/x')?.mode).toEqual(httpStatus(503))
  })

  it('method comparison is case-insensitive', () => {
    const store = createOverridesStore({ warn: vi.fn() })
    store.add({ matcher: exact('post', '/x'), mode: httpStatus(409) })
    expect(store.resolve('POST', '/x')?.mode).toEqual(httpStatus(409))
    expect(store.resolve('post', '/x')?.mode).toEqual(httpStatus(409))
  })

  it('returns undefined when nothing matches', () => {
    const store = createOverridesStore({ warn: vi.fn() })
    expect(store.resolve('GET', '/none')).toBeUndefined()
  })
})
