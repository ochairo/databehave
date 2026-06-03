/**
 * Unit tests for the OAS → route-table builders
 * (`buildOpenApiRoutes`, `buildOpenApiResponseGenerators`).
 *
 * Calls the builders directly with hand-rolled OAS docs so each
 * routing branch (status preference, empty schema, 204, skip,
 * walker-error fallback) has a focused assertion.
 */
import { describe, expect, it } from 'vitest'

import {
  buildOpenApiResponseGenerators,
  buildOpenApiRoutes,
} from '../src/openapi/register.js'
import type { Handler, MockRequest } from '../src/types.js'
import type { OasDoc } from '../src/openapi/walker.js'

// `OasDoc` only declares `components` in the production type (the
// walker accesses every other field through structural casts), so
// test fixtures need a `as unknown as OasDoc` step to add `openapi`
// / `info` / `paths`. Centralized here so the cast is one-line and
// honest, not sprinkled through every test.
//
// TODO(0.2.x): widen `OasDoc` in `src/openapi/walker.ts` to declare
// the structural fields the walker actually reads (`paths`, `info`,
// `openapi`), then drop the `as unknown as OasDoc` here and inside
// `walker.test.ts`. Keeping the cast hides accidental type drift.
const DOC = (paths: Record<string, unknown>): OasDoc =>
  ({
    openapi: '3.0.0',
    info: { title: 't', version: '0' },
    paths,
  }) as unknown as OasDoc

const jsonSchema = (schema: unknown) => ({
  content: { 'application/json': { schema } },
})

/**
 * Synthesize a minimal `MockRequest` so a handler returned by
 * `buildOpenApiRoutes` can be invoked in isolation. Centralized so a
 * `MockRequest` shape change touches one place.
 */
const invoke = (
  handler: Handler,
  method: string,
  path: string,
): ReturnType<Handler> => {
  const url = `http://x${path}`
  const req: MockRequest = {
    method: method.toLowerCase() as MockRequest['method'],
    url,
    path,
    query: {},
    queryAll: {},
    params: {},
    headers: {},
    // TODO(0.2.x): replace this and the sibling `method` cast with a
    // real typed `MockRequest` fixture factory; the per-line
    // casts hide future signature drift on `json` / `method`.
    json: (async () => ({})) as MockRequest['json'],
    text: async () => '',
    raw: () => new Request(url),
  }
  return handler(req)
}

describe('buildOpenApiRoutes', () => {
  it('converts `{id}` segments to `:id` route keys', async () => {
    const routes = buildOpenApiRoutes(
      DOC({
        '/u/{id}': {
          get: { responses: { '200': jsonSchema({ type: 'object' }) } },
        },
      }),
    )
    expect([...routes.keys()]).toEqual(['GET /u/:id'])
  })

  it('skips routes whose key is in `skip`', () => {
    const routes = buildOpenApiRoutes(
      DOC({
        '/a': { get: { responses: { '200': jsonSchema({ type: 'object' }) } } },
        '/b': { get: { responses: { '200': jsonSchema({ type: 'object' }) } } },
      }),
      { skip: new Set(['GET /a']) },
    )
    expect([...routes.keys()]).toEqual(['GET /b'])
  })

  it('ignores unsupported HTTP methods (e.g. trace)', () => {
    const routes = buildOpenApiRoutes(
      DOC({
        '/x': {
          get: { responses: { '200': jsonSchema({ type: 'object' }) } },
          trace: { responses: { '200': jsonSchema({ type: 'object' }) } },
        },
      }),
    )
    expect([...routes.keys()]).toEqual(['GET /x'])
  })

  it('prefers a declared 200 over other 2xx statuses', async () => {
    const routes = buildOpenApiRoutes(
      DOC({
        '/m': {
          post: {
            responses: {
              '201': jsonSchema({ type: 'object', properties: { a: { type: 'string' } } }),
              '200': jsonSchema({ type: 'object', properties: { b: { type: 'string' } } }),
            },
          },
        },
      }),
    )
    const handler = routes.get('POST /m')!
    const res = await invoke(handler, 'POST', '/m')
    expect(Object.keys((res as { json: object }).json)).toEqual(['b'])
  })

  it('emits a no-body stub for 204-only mutations', async () => {
    const routes = buildOpenApiRoutes(
      DOC({
        '/d': { delete: { responses: { '204': { description: 'no body' } } } },
      }),
    )
    const handler = routes.get('DELETE /d')!
    const res = await invoke(handler, 'DELETE', '/d')
    // 204 path → stub envelope, NOT an `{ empty: true }` body, since
    // @databehave/server's stub builder is symmetrical with the no-schema
    // case (mutating method → `{ success: true, message: null }`).
    expect((res as { json: { success: boolean } }).json.success).toBe(true)
  })

  it('reports empty `schema: {}` via `onEmptySchema` and serves a stub', async () => {
    const seen: Array<[string, string, number]> = []
    const routes = buildOpenApiRoutes(
      DOC({
        '/e': { get: { responses: { '200': jsonSchema({}) } } },
      }),
      { onEmptySchema: (m, p, s) => seen.push([m, p, s]) },
    )
    expect(seen).toEqual([['get', '/e', 200]])
    expect(routes.has('GET /e')).toBe(true)
  })

  it('reports walker failures via `onWalkError` and serves a stub instead', async () => {
    const seen: Array<[string, string, string]> = []
    const routes = buildOpenApiRoutes(
      DOC({
        '/bad': {
          get: { responses: { '200': jsonSchema({ type: 'mystery' }) } },
        },
      }),
      {
        onWalkError: (m, p, err) =>
          seen.push([m, p, (err as Error).message]),
      },
    )
    expect(seen[0]?.[0]).toBe('get')
    expect(seen[0]?.[1]).toBe('/bad')
    expect(seen[0]?.[2]).toMatch(/unsupported OpenAPI node/)
    expect(routes.has('GET /bad')).toBe(true)
  })

  it('returns an empty map when `paths` is missing', () => {
    expect(buildOpenApiRoutes({ openapi: '3.0.0' } as OasDoc).size).toBe(0)
  })

  it('skips the `/` placeholder path', () => {
    const routes = buildOpenApiRoutes(
      DOC({
        '/': { get: { responses: { '200': jsonSchema({ type: 'object' }) } } },
      }),
    )
    expect(routes.size).toBe(0)
  })
})

describe('buildOpenApiResponseGenerators', () => {
  it('yields a stable body per `(route, status)` tuple', () => {
    const gens = buildOpenApiResponseGenerators(
      DOC({
        '/err': {
          get: {
            responses: {
              '500': jsonSchema({
                type: 'object',
                properties: {
                  code: { type: 'string', minLength: 3, maxLength: 3 },
                },
              }),
            },
          },
        },
      }),
    )
    const gen = gens.get('GET /err')!.get(500)!
    const a = gen()
    const b = gen()
    expect(a).toEqual(b)
    expect(typeof (a as { code: string }).code).toBe('string')
  })

  it('skips non-numeric and non-JSON responses', () => {
    const gens = buildOpenApiResponseGenerators(
      DOC({
        '/r': {
          get: {
            responses: {
              default: jsonSchema({ type: 'object' }),
              '200': { content: { 'text/plain': { schema: { type: 'string' } } } },
            },
          },
        },
      }),
    )
    expect(gens.size).toBe(0)
  })

  it('skips empty `schema: {}` so mock-mode envelope wins', () => {
    const gens = buildOpenApiResponseGenerators(
      DOC({
        '/x': {
          get: { responses: { '500': jsonSchema({}) } },
        },
      }),
    )
    expect(gens.size).toBe(0)
  })

  it('swallows walker errors silently (the handler-side `onWalkError` already covers it)', () => {
    const gens = buildOpenApiResponseGenerators(
      DOC({
        '/x': {
          get: { responses: { '500': jsonSchema({ type: 'mystery' }) } },
        },
      }),
    )
    expect(gens.size).toBe(0)
  })

  it('returns an empty map when `paths` is missing', () => {
    expect(
      buildOpenApiResponseGenerators({ openapi: '3.0.0' } as OasDoc).size,
    ).toBe(0)
  })
})
