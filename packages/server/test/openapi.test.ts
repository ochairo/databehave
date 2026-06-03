import { describe, expect, it } from 'vitest'

import { createServer } from '../src/index.js'

/**
 * Tiny OpenAPI doc covering: a $ref'd object schema, an inline array
 * with primitives, a `:param` path, an endpoint with no schema (stub
 * fallback), and a mutating method (POST stub shape).
 */
const OAS_JSON = JSON.stringify({
  openapi: '3.0.0',
  info: { title: '@databehave/server-oas-test', version: '0.0.1' },
  paths: {
    '/api/v1/ping': {
      get: {
        responses: {
          '200': {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Ping' } },
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
                  items: { type: 'string', minLength: 3, maxLength: 5 },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/users/{id}': {
      get: {
        responses: {
          '200': {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/User' } },
            },
          },
        },
      },
    },
    '/api/v1/health': { get: { responses: { '200': { description: 'empty' } } } },
    '/api/v1/things': { post: { responses: { '200': { description: 'empty' } } } },
  },
  components: {
    schemas: {
      Ping: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          count: { type: 'integer', minimum: 1, maximum: 5 },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 8 },
          name: { type: 'string', minLength: 3, maxLength: 10 },
        },
      },
    },
  },
})

describe('createServer (openapi walker)', () => {
  it('serves a $ref-backed JSON schema with deterministic output', async () => {
    const server = createServer({ openapi: OAS_JSON })

    const a = await server.fetch(new Request('http://localhost/api/v1/ping'))
    expect(a.status).toBe(200)
    expect(a.headers.get('content-type')).toMatch(/application\/json/)
    const aJson = (await a.json()) as { ok: boolean; count: number }
    // Deterministic placeholders: boolean → false, integer with minimum=1 → 1.
    expect(aJson).toEqual({ ok: false, count: 1 })

    // Same URL → same body (structurally deterministic OAS-only generator).
    const b = await server.fetch(new Request('http://localhost/api/v1/ping'))
    expect(await b.json()).toEqual(aJson)
  })

  it('serves an inline array schema', async () => {
    const server = createServer({ openapi: OAS_JSON })
    const res = await server.fetch(new Request('http://localhost/api/v1/items'))
    expect(res.status).toBe(200)
    // Single string placeholder by default (no `minItems`).
    expect(await res.json()).toEqual(['string'])
  })

  it('rewrites `/{id}` to `/:id` and serves a deterministic body', async () => {
    const server = createServer({ openapi: OAS_JSON })

    const a = await server.fetch(new Request('http://localhost/api/v1/users/42'))
    expect(a.status).toBe(200)
    const aJson = (await a.json()) as { id: string; name: string }
    expect(aJson).toEqual({ id: 'string', name: 'string' })

    // OAS-only mode is per-route, not per-param: same shape on a
    // different `:id`. Per-param variation is reserved for the
    // future seeded mode (brief #11).
    const b = await server.fetch(new Request('http://localhost/api/v1/users/99'))
    expect(await b.json()).toEqual(aJson)
  })

  it('serves the stub body for endpoints without a 200 schema', async () => {
    const server = createServer({ openapi: OAS_JSON })

    const get = await server.fetch(new Request('http://localhost/api/v1/health'))
    expect(await get.json()).toEqual({})

    const post = await server.fetch(
      new Request('http://localhost/api/v1/things', { method: 'POST' }),
    )
    expect(await post.json()).toEqual({ success: true, message: null })
  })

  it('lets hand-written routes win over OAS-derived ones (no duplicate error)', async () => {
    const server = createServer({
      openapi: OAS_JSON,
      routes: {
        'GET /api/v1/ping': () => ({ json: { hand: 'written' } }),
      },
    })
    const res = await server.fetch(new Request('http://localhost/api/v1/ping'))
    expect(await res.json()).toEqual({ hand: 'written' })
  })

  it('still 404s for unknown paths even with OAS enabled', async () => {
    const server = createServer({ openapi: OAS_JSON })
    const res = await server.fetch(new Request('http://localhost/api/v1/does-not-exist'))
    expect(res.status).toBe(404)
  })

  it('falls back to stub + invokes onOpenApiWalkError on walker failure', async () => {
    const broken = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 't', version: '0.0' },
      paths: {
        '/api/v1/broken': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Missing' },
                  },
                },
              },
            },
          },
        },
      },
    })
    const errs: Array<{ method: string; path: string; msg: string }> = []
    const server = createServer({
      openapi: broken,
      onOpenApiWalkError: (method, path, err) => {
        errs.push({ method, path, msg: (err as Error).message })
      },
    })
    const res = await server.fetch(new Request('http://localhost/api/v1/broken'))
    expect(await res.json()).toEqual({}) // GET stub
    expect(errs).toHaveLength(1)
    expect(errs[0]?.method).toBe('get')
    expect(errs[0]?.path).toBe('/api/v1/broken')
    expect(errs[0]?.msg).toMatch(/\$ref not found/)
  })

  it('reports `schema: {}` via onOpenApiEmptySchema (not as a walk error) and serves a stub', async () => {
    // OAS `schema: {}` means "any JSON value" per JSON Schema, so we
    // do NOT raise it as a walker failure. We surface it via the
    // dedicated `onOpenApiEmptySchema` callback so consumers can warn
    // the OAS author to fill the schema, and serve a stub body.
    const doc = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 't', version: '0.0' },
      paths: {
        '/api/v1/anything': {
          get: {
            responses: {
              '200': { content: { 'application/json': { schema: {} } } },
            },
          },
        },
      },
    })
    const errs: unknown[] = []
    const empties: Array<{ method: string; path: string; status: number }> = []
    const server = createServer({
      openapi: doc,
      onOpenApiWalkError: (_m, _p, err) => errs.push(err),
      onOpenApiEmptySchema: (method, path, status) =>
        empties.push({ method, path, status }),
    })
    const res = await server.fetch(new Request('http://localhost/api/v1/anything'))
    expect(res.status).toBe(200)
    // GET stub body is `{}`.
    expect(await res.json()).toEqual({})
    expect(errs).toHaveLength(0)
    expect(empties).toEqual([
      { method: 'get', path: '/api/v1/anything', status: 200 },
    ])
  })

  it('rejects YAML-form OpenAPI documents (JSON-only loader)', () => {
    const yamlDoc = `openapi: 3.0.0\ninfo: { title: t, version: '0' }\npaths: {}\n`
    expect(() => createServer({ openapi: yamlDoc })).toThrow(
      /failed to parse JSON/,
    )
  })

  it('OAS 3.0 `nullable: true` picks the concrete branch (never null)', async () => {
    const doc = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 't', version: '0' },
      paths: {
        '/api/v1/maybe': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        name: { type: 'string', nullable: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })
    const server = createServer({ openapi: doc })
    const res = await server.fetch(new Request('http://localhost/api/v1/maybe'))
    const body = (await res.json()) as { name: string | null }
    // OAS-only generator never emits `null` from a nullable widening —
    // the concrete branch wins. Callers that want explicit `null` use
    // `examples` or `enum`.
    expect(body.name).toBe('string')
  })

  it('falls back to the smallest declared 2xx response when 200 is absent', async () => {
    const doc = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 't', version: '0' },
      paths: {
        '/api/v1/created': {
          post: {
            responses: {
              '201': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { id: { type: 'integer', minimum: 1, maximum: 9 } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })
    const server = createServer({ openapi: doc })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/created', { method: 'POST' }),
    )
    expect(res.status).toBe(200) // dispatcher default \u2014 OAS status is only schema-source
    const body = (await res.json()) as { id: number }
    // Stub fallback would return { success: true, message: null } — verify
    // we got the 201 schema instead. `minimum: 1` on `id` so generator emits 1.
    expect(body).toEqual({ id: 1 })
  })

  // Adversarial OAS inputs. The generator surfaces unknown nodes via
  // `onOpenApiWalkError` rather than crashing the server.
  const adversarialDoc = (schema: unknown): string =>
    JSON.stringify({
      openapi: '3.0.0',
      info: { title: 't', version: '0' },
      paths: {
        '/api/v1/x': {
          get: {
            responses: {
              '200': { content: { 'application/json': { schema } } },
            },
          },
        },
      },
    })

  it('reports an unknown `type` as a walk error and falls back to the GET stub', async () => {
    const errs: Array<{ msg: string }> = []
    const server = createServer({
      openapi: adversarialDoc({ type: 'mystery' }),
      onOpenApiWalkError: (_m, _p, err) =>
        errs.push({ msg: (err as Error).message }),
    })
    const res = await server.fetch(new Request('http://localhost/api/v1/x'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
    expect(errs).toHaveLength(1)
    expect(errs[0]?.msg).toMatch(/unsupported OpenAPI node/)
  })
})
