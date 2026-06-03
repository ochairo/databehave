import { afterEach, describe, expect, it } from 'vitest'

import { defineConfig } from '../src/index.js'

const originalEnv = process.env.NODE_ENV

afterEach(() => {
  process.env.NODE_ENV = originalEnv
})

describe('defineConfig', () => {
  it('deep-freezes the config in non-production so nested mutation throws', () => {
    process.env.NODE_ENV = 'test'
    const config = defineConfig({
      routes: { 'GET /a': () => ({ json: { ok: true } }) },
      cors: { allowMethods: ['GET'] },
    })
    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(config.routes)).toBe(true)
    expect(Object.isFrozen(config.cors)).toBe(true)
    expect(Object.isFrozen(config.cors!.allowMethods)).toBe(true)
    expect(() => {
      // The exact mutation the freeze is meant to catch.
      ;(config.routes as Record<string, unknown>)['GET /b'] = () => ({ json: {} })
    }).toThrow(TypeError)
  })

  it('does NOT freeze in production', () => {
    process.env.NODE_ENV = 'production'
    const config = defineConfig({
      routes: { 'GET /a': () => ({ json: { ok: true } }) },
    })
    expect(Object.isFrozen(config)).toBe(false)
    // Patching after defineConfig() is a legitimate dev pattern in prod
    // wiring (env-specific overrides).
    ;(config.routes as Record<string, unknown>)['GET /b'] = () => ({ json: {} })
  })

  it('tolerates cyclic references inside the config without recursing forever', () => {
    process.env.NODE_ENV = 'test'
    // Forge a cycle that survives the (private) deepFreeze traversal.
    // A real `Config` doesn't contain cycles, but the freeze
    // helper still has to be cycle-safe so a future addition (or a
    // mis-used config) doesn't crash boot.
    type CyclicCors = { allowMethods: string[]; self?: unknown }
    const cors: CyclicCors = { allowMethods: ['GET'] }
    cors.self = cors
    const config = defineConfig({
      routes: { 'GET /a': () => ({ json: { ok: true } }) },
      cors: cors as unknown as import('../src/index.js').CorsConfig,
    })
    expect(Object.isFrozen(config.cors)).toBe(true)
    expect(Object.isFrozen((config.cors as unknown as CyclicCors).self)).toBe(true)
  })

  it('respects already-frozen sub-trees instead of revisiting them', () => {
    process.env.NODE_ENV = 'test'
    // A consumer who pre-froze part of the config (e.g. shared constant)
    // must not trigger a re-walk of that sub-tree on every defineConfig
    // call — the `Object.isFrozen` short-circuit covers this.
    const shared = Object.freeze({ allowMethods: Object.freeze(['GET']) })
    const config = defineConfig({
      routes: { 'GET /a': () => ({ json: { ok: true } }) },
      cors: shared as unknown as import('../src/index.js').CorsConfig,
    })
    expect(Object.isFrozen(config.cors)).toBe(true)
    expect(Object.isFrozen(config.cors!.allowMethods)).toBe(true)
  })
})
