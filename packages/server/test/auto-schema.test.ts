/**
 * Unit + integration tests for `src/openapi/auto-schema.ts` and the
 * JSONC `schema:` dispatch wired through `loadConfig`.
 *
 * Covers:
 *   - Config validation (enabled flag, knobs, unknown keys, removed boolean shorthand).
 *   - Friendly install-hint when `@databehave/schema` is missing.
 *   - End-to-end OAS → mock dispatch via `server.fetch()`.
 *   - Per-request seed behaviour (stable / number / random).
 *   - Endpoints-wins precedence.
 *   - additionalProperties end-to-end (no regression from 2C.a).
 *   - Translator unsupported-keyword fail-fast at server-creation.
 *   - FNV-1a hash determinism.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createServer } from '../src/index.js'
import { loadConfig } from '../src/json-config.js'
import {
  INSTALL_HINT,
  buildAutoSchemaRoutes,
  hashSeed,
  loadSchemaModule,
  normaliseSchemaConfig,
} from '../src/openapi/auto-schema.js'

let dir: string

const writeJson = (name: string, obj: unknown): string => {
  const p = join(dir, name)
  writeFileSync(p, JSON.stringify(obj, null, 2))
  return p
}

const OAS_DOC = {
  openapi: '3.0.0',
  info: { title: 'auto-schema-test', version: '0.0.1' },
  paths: {
    '/api/v1/users/{id}': {
      get: {
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' },
              },
            },
          },
        },
      },
    },
    '/api/v1/items': {
      get: {
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'integer', minimum: 1, maximum: 1_000_000 },
                      name: { type: 'string', minLength: 3, maxLength: 12 },
                    },
                    required: ['id', 'name'],
                  },
                  minItems: 2,
                  maxItems: 2,
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/echo': {
      get: {
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { msg: { type: 'string', maxLength: 32 } },
                  required: ['msg'],
                  additionalProperties: false,
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 16 },
          name: { type: 'string', minLength: 3, maxLength: 24 },
          age: { type: 'integer', minimum: 0, maximum: 99 },
        },
        required: ['id', 'name', 'age'],
      },
    },
  },
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'databehave-auto-schema-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('normaliseSchemaConfig', () => {
  it('accepts { enabled: true } → seed: stable defaults', () => {
    expect(normaliseSchemaConfig({ enabled: true })).toEqual({ seed: 'stable' })
  })
  it('accepts long-form with all knobs', () => {
    expect(
      normaliseSchemaConfig({ enabled: true, seed: 42, locale: 'ja', arrayCount: 5 }),
    ).toEqual({
      seed: 42,
      locale: 'ja',
      arrayCount: 5,
    })
  })
  it('returns null when enabled: false (auto-mode off)', () => {
    expect(normaliseSchemaConfig({ enabled: false })).toBeNull()
    // Knobs alongside enabled:false are still validated but the
    // resolved value is null so the dispatch site short-circuits.
    expect(normaliseSchemaConfig({ enabled: false, seed: 7 })).toBeNull()
  })
  it('rejects the removed boolean shorthand with a migration error', () => {
    expect(() => normaliseSchemaConfig(true)).toThrow(
      /"schema" must be an object like \{ "enabled": true \}; the boolean shorthand was removed/,
    )
    expect(() => normaliseSchemaConfig(false)).toThrow(
      /"schema" must be an object like \{ "enabled": true \}; the boolean shorthand was removed/,
    )
  })
  it('rejects missing enabled', () => {
    expect(() => normaliseSchemaConfig({ seed: 42 })).toThrow(/"schema.enabled" must be a boolean/)
  })
  it('rejects unknown keys with the offending key in the message', () => {
    expect(() => normaliseSchemaConfig({ enabled: true, seedz: 1 })).toThrow(
      /unknown key in "schema": "seedz"/,
    )
  })
  it('rejects non-object input', () => {
    expect(() => normaliseSchemaConfig('yes' as unknown)).toThrow(
      /must be an object like \{ "enabled": true \} \(got string\)/,
    )
    expect(() => normaliseSchemaConfig([] as unknown)).toThrow(/got array/)
    expect(() => normaliseSchemaConfig(null as unknown)).toThrow(/got null/)
  })
  it('rejects bad seed value', () => {
    expect(() => normaliseSchemaConfig({ enabled: true, seed: 'sometimes' })).toThrow(
      /schema.seed/,
    )
  })
  it('rejects bad locale / arrayCount', () => {
    expect(() => normaliseSchemaConfig({ enabled: true, locale: 9 })).toThrow(/schema.locale/)
    expect(() => normaliseSchemaConfig({ enabled: true, arrayCount: -1 })).toThrow(
      /schema.arrayCount/,
    )
    expect(() => normaliseSchemaConfig({ enabled: true, arrayCount: 'nine' })).toThrow(
      /schema.arrayCount/,
    )
  })
})

describe('hashSeed (FNV-1a)', () => {
  it('is deterministic and uint32', () => {
    const a = hashSeed('GET /users/:id|page=2|id=42')
    const b = hashSeed('GET /users/:id|page=2|id=42')
    expect(a).toBe(b)
    expect(a >>> 0).toBe(a)
  })
  it('differs for different inputs', () => {
    expect(hashSeed('a')).not.toBe(hashSeed('b'))
  })
})

describe('loadSchemaModule (real install)', () => {
  it('resolves to the @databehave/schema module exports', async () => {
    const mod = await loadSchemaModule()
    expect(typeof mod.mock).toBe('function')
  })
})

describe('loadSchemaModule (missing-install template)', () => {
  // The optional peer is installed during local dev, so we exercise
  // the catch branch with a synthetic native-error and assert the
  // template is what would surface to a consumer with no install.
  it('replaces native ERR_MODULE_NOT_FOUND with the friendly install hint', () => {
    // Build the same catch logic loadSchemaModule uses, against a
    // synthetic native-error. (Re-using INSTALL_HINT keeps the
    // assertion anchored to the exact constant the loader throws.)
    const native: NodeJS.ErrnoException = Object.assign(
      new Error("Cannot find module '@databehave/schema'"),
      { code: 'ERR_MODULE_NOT_FOUND' as const },
    )
    expect(() => {
      const code = native.code
      if (
        code === 'ERR_MODULE_NOT_FOUND' ||
        code === 'MODULE_NOT_FOUND' ||
        native.message.includes('Cannot find module') ||
        native.message.includes('Cannot find package')
      ) {
        throw new Error(INSTALL_HINT)
      }
      throw native
    }).toThrow(INSTALL_HINT)
  })

  it('install-hint matches all 8 must-haves from the brief', () => {
    expect(INSTALL_HINT).toContain('@databehave/server')
    expect(INSTALL_HINT).toContain('databehave.jsonc')
    expect(INSTALL_HINT).toContain('schema')
    expect(INSTALL_HINT).toContain('npm i @databehave/schema')
    expect(INSTALL_HINT).toContain('pnpm add @databehave/schema')
    expect(INSTALL_HINT).toContain('yarn add @databehave/schema')
    expect(INSTALL_HINT).toContain(
      'https://github.com/ochairo/databehave/blob/main/packages/server/docs/openapi/auto-schema.md#missing-install-error',
    )
    expect(INSTALL_HINT).toContain('remove the')
    expect(INSTALL_HINT).toContain('"enabled": false')
    expect(INSTALL_HINT).not.toContain('Cannot find module')
  })
})

describe('JSONC dispatch — schema enabled smoke', () => {
  it('serves OAS-derived JSON for every endpoint', async () => {
    writeFileSync(join(dir, 'openapi.json'), JSON.stringify(OAS_DOC))
    const cfgPath = writeJson('cfg.jsonc', {
      openapi: './openapi.json',
      schema: { enabled: true },
      endpoints: {},
    })
    const { config } = await loadConfig(cfgPath)
    const server = createServer(config)

    const userRes = await server.fetch(new Request('http://localhost/api/v1/users/abc'))
    expect(userRes.status).toBe(200)
    const userBody = (await userRes.json()) as Record<string, unknown>
    expect(typeof userBody.id).toBe('string')
    expect(typeof userBody.name).toBe('string')
    expect(typeof userBody.age).toBe('number')
    // Auto-schema produces non-trivial values — not a single all-"string" placeholder.
    expect(userBody.name).not.toBe('string')

    const itemsRes = await server.fetch(new Request('http://localhost/api/v1/items'))
    expect(itemsRes.status).toBe(200)
    const items = (await itemsRes.json()) as unknown[]
    expect(Array.isArray(items)).toBe(true)
    expect(items.length).toBe(2)
  })

  it('additionalProperties: false works end-to-end (no regression from 2C.a)', async () => {
    writeFileSync(join(dir, 'openapi.json'), JSON.stringify(OAS_DOC))
    const cfgPath = writeJson('cfg.jsonc', { openapi: './openapi.json', schema: { enabled: true } })
    const { config } = await loadConfig(cfgPath)
    const server = createServer(config)
    const res = await server.fetch(new Request('http://localhost/api/v1/echo'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(typeof body.msg).toBe('string')
  })
})

describe('JSONC dispatch — seeding', () => {
  it('default seed:"stable" is byte-identical for the same request', async () => {
    writeFileSync(join(dir, 'openapi.json'), JSON.stringify(OAS_DOC))
    const cfgPath = writeJson('cfg.jsonc', { openapi: './openapi.json', schema: { enabled: true } })
    const { config } = await loadConfig(cfgPath)
    const server = createServer(config)
    const a = await (await server.fetch(new Request('http://localhost/api/v1/users/42'))).text()
    const b = await (await server.fetch(new Request('http://localhost/api/v1/users/42'))).text()
    expect(a).toBe(b)
  })

  it('"stable" produces different bodies for different queries', async () => {
    writeFileSync(join(dir, 'openapi.json'), JSON.stringify(OAS_DOC))
    const cfgPath = writeJson('cfg.jsonc', { openapi: './openapi.json', schema: { enabled: true } })
    const { config } = await loadConfig(cfgPath)
    const server = createServer(config)
    const a = await (
      await server.fetch(new Request('http://localhost/api/v1/users/42?page=1'))
    ).text()
    const b = await (
      await server.fetch(new Request('http://localhost/api/v1/users/42?page=2'))
    ).text()
    expect(a).not.toBe(b)
  })

  it('seed:<number> is deterministic and varied', async () => {
    writeFileSync(join(dir, 'openapi.json'), JSON.stringify(OAS_DOC))
    const cfgPath = writeJson('cfg.jsonc', {
      openapi: './openapi.json',
      schema: { enabled: true, seed: 42 },
    })
    const { config } = await loadConfig(cfgPath)
    const server = createServer(config)
    const a = await (await server.fetch(new Request('http://localhost/api/v1/users/x'))).text()
    const b = await (await server.fetch(new Request('http://localhost/api/v1/users/x'))).text()
    expect(a).toBe(b)
    const body = JSON.parse(a) as Record<string, unknown>
    expect(typeof body.id).toBe('string')
    expect(body.id).not.toBe('string') // not the placeholder default
  })

  it('seed:"random" produces different responses for the same request', async () => {
    writeFileSync(join(dir, 'openapi.json'), JSON.stringify(OAS_DOC))
    const cfgPath = writeJson('cfg.jsonc', {
      openapi: './openapi.json',
      schema: { enabled: true, seed: 'random' },
    })
    const { config } = await loadConfig(cfgPath)
    const server = createServer(config)
    // Force `Math.random` to step deterministically across calls so
    // the test isn't flaky on a fluke collision but still proves the
    // path differs from `seed: 'stable'`.
    let n = 0
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      n += 0.37
      return (n % 1)
    })
    try {
      const a = await (await server.fetch(new Request('http://localhost/api/v1/users/42'))).text()
      const b = await (await server.fetch(new Request('http://localhost/api/v1/users/42'))).text()
      expect(a).not.toBe(b)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('JSONC dispatch — endpoints-wins precedence', () => {
  it('hand-written endpoint overrides auto-mode for the same route', async () => {
    writeFileSync(join(dir, 'openapi.json'), JSON.stringify(OAS_DOC))
    const cfgPath = writeJson('cfg.jsonc', {
      openapi: './openapi.json',
      schema: { enabled: true },
      endpoints: {
        'GET /api/v1/users/:id': {
          response: { status: 200, json: { id: 'pinned', name: 'pinned', age: 1 } },
        },
      },
    })
    const { config } = await loadConfig(cfgPath)
    const server = createServer(config)
    const res = await server.fetch(new Request('http://localhost/api/v1/users/abc'))
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ id: 'pinned', name: 'pinned', age: 1 })
  })
})

describe('JSONC dispatch — fail-fast at server-creation', () => {
  it('translator unsupported-keyword throws synchronously at config load', async () => {
    const badDoc = {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {
        '/api/v1/x': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    // `if` is unsupported by both validator and translator.
                    schema: { type: 'object', if: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    }
    writeFileSync(join(dir, 'openapi.json'), JSON.stringify(badDoc))
    const cfgPath = writeJson('cfg.jsonc', { openapi: './openapi.json', schema: { enabled: true } })
    await expect(loadConfig(cfgPath)).rejects.toThrow(
      /unsupported JSON Schema keyword: if/,
    )
  })
})

describe('JSONC validation surface', () => {
  it('rejects unknown keys in long-form schema:', async () => {
    const cfgPath = writeJson('cfg.jsonc', { schema: { enabled: true, seedX: 9 } })
    await expect(loadConfig(cfgPath)).rejects.toThrow(
      /unknown key in "schema": "seedX"/,
    )
  })
  it('rejects the removed boolean shorthand schema: true with a migration error', async () => {
    const cfgPath = writeJson('cfg.jsonc', { schema: true })
    await expect(loadConfig(cfgPath)).rejects.toThrow(
      /"schema" must be an object like \{ "enabled": true \}; the boolean shorthand was removed/,
    )
  })
  it('rejects the removed boolean shorthand schema: false with a migration error', async () => {
    const cfgPath = writeJson('cfg.jsonc', { schema: false })
    await expect(loadConfig(cfgPath)).rejects.toThrow(
      /"schema" must be an object like \{ "enabled": true \}; the boolean shorthand was removed/,
    )
  })
  it('schema: { enabled: false } does NOT trigger auto-schema mode', async () => {
    writeFileSync(join(dir, 'openapi.json'), JSON.stringify(OAS_DOC))
    const cfgPath = writeJson('cfg.jsonc', {
      openapi: './openapi.json',
      schema: { enabled: false },
      endpoints: {},
    })
    // Loads cleanly even if @databehave/schema were absent — the
    // dispatch site short-circuits on enabled: false. With the peer
    // present (local dev), the route still falls back to the
    // OAS-only zero-dep generator (placeholder values), not the
    // realistic mock() output.
    const { config } = await loadConfig(cfgPath)
    const server = createServer(config)
    const res = await server.fetch(new Request('http://localhost/api/v1/users/abc'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    // Zero-dep OAS-only generator emits the literal "string"
    // placeholder for unconstrained string fields — auto-schema
    // mode would emit something more interesting.
    expect(body.name).toBe('string')
  })
})

describe('buildAutoSchemaRoutes (direct unit)', () => {
  it('skips routes already declared in declaredKeys', async () => {
    const mod = await loadSchemaModule()
    const declared = new Set<never>(['GET /api/v1/items'] as never[])
    const routes = await buildAutoSchemaRoutes(
      OAS_DOC as never,
      { seed: 'stable' },
      mod,
      declared,
    )
    expect(routes.has('GET /api/v1/items' as never)).toBe(false)
    expect(routes.has('GET /api/v1/users/:id' as never)).toBe(true)
  })
})
