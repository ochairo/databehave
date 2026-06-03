import { describe, expect, it } from 'vitest'

import { resolveAdminCors } from '../../src/admin/resolve-cors.js'

describe('resolveAdminCors', () => {
  it("'auto' + loopback-only → wildcard", () => {
    const h = resolveAdminCors('loopback-only', 'auto')
    expect(h['access-control-allow-origin']).toBe('*')
    expect(h['access-control-allow-methods']).toContain('GET')
  })

  it("'auto' + bind:any → no CORS headers (same-origin)", () => {
    expect(resolveAdminCors('any', 'auto')).toEqual({})
  })

  it("'any' → wildcard regardless of bind", () => {
    expect(resolveAdminCors('loopback-only', 'any')['access-control-allow-origin']).toBe('*')
    expect(resolveAdminCors('any', 'any')['access-control-allow-origin']).toBe('*')
  })

  it("'same-origin' → empty", () => {
    expect(resolveAdminCors('loopback-only', 'same-origin')).toEqual({})
    expect(resolveAdminCors('any', 'same-origin')).toEqual({})
  })

  it('{ origin: string } → exact origin + Vary', () => {
    const h = resolveAdminCors('any', { origin: 'https://example.com' })
    expect(h['access-control-allow-origin']).toBe('https://example.com')
    expect(h.vary).toBe('Origin')
  })

  it('{ origin: string[] } → comma-joined list', () => {
    const h = resolveAdminCors('any', { origin: ['https://a.com', 'https://b.com'] })
    expect(h['access-control-allow-origin']).toBe('https://a.com, https://b.com')
  })
})
