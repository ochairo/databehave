/**
 * Inbound request-validation middleware (opt-in).
 *
 * Integration tests: build a tiny OAS document, mount it via
 * `createServer({ validation: { request: true } })`, and
 * exercise the request envelope (RFC 7807 problem+json on failure).
 */
import { describe, expect, it } from 'vitest'

import { createServer } from '../src/index.js'

const OAS = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'rv-test', version: '0.0.1' },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
    },
  },
  paths: {
    '/api/v1/widgets': {
      post: {
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            in: 'query',
            name: 'kind',
            required: false,
            schema: { type: 'string', enum: ['gold', 'silver'] },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'age'],
                properties: {
                  name: { type: 'string', minLength: 1 },
                  age: { type: 'integer', minimum: 0 },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'ok' } },
      },
    },
  },
})

const buildServer = (opts: { validation?: { request: boolean } } = {}) =>
  createServer({
    openapi: OAS,
    ...(opts.validation ? { validation: opts.validation } : {}),
    routes: {
      'POST /api/v1/widgets': () => ({ json: { ok: true } }),
    },
  })

const post = (
  body: unknown,
  headers: Record<string, string> = {
    authorization: 'Bearer t',
    'content-type': 'application/json',
  },
  search = '',
) =>
  new Request(`http://localhost/api/v1/widgets${search}`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

describe('request-validation middleware (opt-in)', () => {
  it('accepts a fully-valid request and returns the handler body (200)', async () => {
    const server = buildServer({ validation: { request: true } })
    const res = await server.fetch(post({ name: 'a', age: 1 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('rejects a request missing Authorization with 401 + problem+json', async () => {
    const server = buildServer({ validation: { request: true } })
    const res = await server.fetch(
      post({ name: 'a', age: 1 }, { 'content-type': 'application/json' }),
    )
    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toBe('application/problem+json')
    const body = await res.json()
    expect(body.type).toBe(
      'https://github.com/ochairo/databehave/blob/main/docs/errors/unauthorized.md',
    )
    expect(body.status).toBe(401)
  })

  it('401 response carries WWW-Authenticate: Bearer realm="api" (RFC 7235)', async () => {
    const server = buildServer({ validation: { request: true } })
    const res = await server.fetch(
      post({ name: 'a', age: 1 }, { 'content-type': 'application/json' }),
    )
    expect(res.headers.get('www-authenticate')).toBe('Bearer realm="api"')
  })

  it('rejects a request with text/plain Content-Type with 415', async () => {
    const server = buildServer({ validation: { request: true } })
    const res = await server.fetch(
      post('not-json', { authorization: 'Bearer t', 'content-type': 'text/plain' }),
    )
    expect(res.status).toBe(415)
  })

  it('rejects a body missing the `name` field with 422 + pointer /body', async () => {
    const server = buildServer({ validation: { request: true } })
    const res = await server.fetch(post({ age: 1 }))
    expect(res.status).toBe(422)
    const body = (await res.json()) as { violations: { path: string; keyword: string }[] }
    expect(
      body.violations.some((v) => v.keyword === 'required' && v.path === '/body/name'),
    ).toBe(true)
  })

  it('rejects a body where `age` is below schema minimum with 422 + pointer /body/age', async () => {
    const server = buildServer({ validation: { request: true } })
    const res = await server.fetch(post({ name: 'a', age: -1 }))
    expect(res.status).toBe(422)
    const body = (await res.json()) as { violations: { path: string; keyword: string }[] }
    expect(body.violations.some((v) => v.path === '/body/age' && v.keyword === 'minimum')).toBe(
      true,
    )
  })

  it('rejects a query parameter outside the enum with 422', async () => {
    const server = buildServer({ validation: { request: true } })
    const res = await server.fetch(
      post({ name: 'a', age: 1 }, { authorization: 'Bearer t', 'content-type': 'application/json' }, '?kind=bronze'),
    )
    expect(res.status).toBe(422)
    const body = (await res.json()) as { violations: { path: string; keyword: string }[] }
    expect(body.violations.some((v) => v.path === '/query/kind' && v.keyword === 'enum')).toBe(true)
  })

  it('rejects a malformed JSON body with 400', async () => {
    const server = buildServer({ validation: { request: true } })
    const res = await server.fetch(post('{not json'))
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toBe('application/problem+json')
    const body = (await res.json()) as { type: string; detail: string }
    // 400 detail is a literal string — must not echo raw `JSON.parse` error wording.
    expect(body.detail).toBe('malformed JSON body')
    // URI swap: every envelope `type` uses the github.com docs path.
    expect(body.type).toBe(
      'https://github.com/ochairo/databehave/blob/main/docs/errors/malformed-body.md',
    )
  })

  it('rejects a body exceeding maxBodyBytes with 413 + problem+json', async () => {
    const server = createServer({
      openapi: OAS,
      validation: { request: true, maxBodyBytes: 64 },
      routes: { 'POST /api/v1/widgets': () => ({ json: { ok: true } }) },
    })
    // Build a JSON body whose UTF-8 byte length is well above 64.
    const big = { name: 'x'.repeat(200), age: 1 }
    const res = await server.fetch(post(big))
    expect(res.status).toBe(413)
    expect(res.headers.get('content-type')).toBe('application/problem+json')
    const body = (await res.json()) as { type: string; status: number; detail: string }
    expect(body.status).toBe(413)
    expect(body.type).toBe(
      'https://github.com/ochairo/databehave/blob/main/docs/errors/payload-too-large.md',
    )
    expect(body.detail).toContain('maxBodyBytes')
  })

  it('uses the github.com docs URL for 422 envelopes (URI swap)', async () => {
    const server = buildServer({ validation: { request: true } })
    const res = await server.fetch(post({ age: 1 }))
    expect(res.status).toBe(422)
    const body = (await res.json()) as { type: string }
    expect(body.type).toBe(
      'https://github.com/ochairo/databehave/blob/main/docs/errors/request-validation.md',
    )
  })

  it('passes everything through when validation is disabled (default off)', async () => {
    const server = buildServer() // no `validation`
    const res = await server.fetch(post({ /* missing required */ }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('body validation does NOT coerce, but param validation DOES', async () => {
    const server = createServer({
      openapi: JSON.stringify({
        openapi: '3.0.3',
        info: { title: 't', version: '0.0.1' },
        paths: {
          '/api/v1/items/{id}': {
            get: {
              parameters: [
                { in: 'path', name: 'id', required: true, schema: { type: 'integer' } },
              ],
              responses: { '200': { description: 'ok' } },
            },
          },
          '/api/v1/echo': {
            post: {
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: { type: 'object', required: ['n'], properties: { n: { type: 'integer' } } },
                  },
                },
              },
              responses: { '200': { description: 'ok' } },
            },
          },
        },
      }),
      validation: { request: true },
      routes: {
        'GET /api/v1/items/:id': () => ({ json: { ok: true } }),
        'POST /api/v1/echo': () => ({ json: { ok: true } }),
      },
    })
    // Param coerced: "42" -> 42 -> passes integer schema.
    const ok = await server.fetch(new Request('http://localhost/api/v1/items/42'))
    expect(ok.status).toBe(200)
    // Body NOT coerced: "42" stays a string -> fails integer schema.
    const bad = await server.fetch(
      new Request('http://localhost/api/v1/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ n: '42' }),
      }),
    )
    expect(bad.status).toBe(422)
  })

  it('validates required headers and api-key (header) security', async () => {
    const server = createServer({
      openapi: JSON.stringify({
        openapi: '3.0.3',
        info: { title: 't', version: '0.0.1' },
        components: {
          securitySchemes: {
            apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
          },
        },
        paths: {
          '/api/v1/secret': {
            get: {
              security: [{ apiKey: [] }],
              parameters: [
                {
                  in: 'header',
                  name: 'X-Trace',
                  required: true,
                  schema: { type: 'string', minLength: 1 },
                },
              ],
              responses: { '200': { description: 'ok' } },
            },
          },
        },
      }),
      validation: { request: true },
      routes: { 'GET /api/v1/secret': () => ({ json: { ok: true } }) },
    })
    // missing api key → 401
    const noKey = await server.fetch(new Request('http://localhost/api/v1/secret'))
    expect(noKey.status).toBe(401)
    // has api key, missing required header → 422
    const noTrace = await server.fetch(
      new Request('http://localhost/api/v1/secret', {
        headers: { 'x-api-key': 'k' },
      }),
    )
    expect(noTrace.status).toBe(422)
    const body = (await noTrace.json()) as { violations: { path: string; keyword: string }[] }
    expect(
      body.violations.some(
        (v) => v.path === '/header/X-Trace' && v.keyword === 'required',
      ),
    ).toBe(true)
    // both present → 200
    const ok = await server.fetch(
      new Request('http://localhost/api/v1/secret', {
        headers: { 'x-api-key': 'k', 'x-trace': 'abc' },
      }),
    )
    expect(ok.status).toBe(200)
  })

  it('validates api-key (query) security and required query param', async () => {
    const server = createServer({
      openapi: JSON.stringify({
        openapi: '3.0.3',
        info: { title: 't', version: '0.0.1' },
        components: {
          securitySchemes: {
            qKey: { type: 'apiKey', in: 'query', name: 'k' },
          },
        },
        paths: {
          '/api/v1/q': {
            get: {
              security: [{ qKey: [] }],
              parameters: [
                { in: 'query', name: 'page', required: true, schema: { type: 'integer' } },
              ],
              responses: { '200': { description: 'ok' } },
            },
          },
        },
      }),
      validation: { request: true },
      routes: { 'GET /api/v1/q': () => ({ json: { ok: true } }) },
    })
    // missing key → 401
    const a = await server.fetch(new Request('http://localhost/api/v1/q?page=1'))
    expect(a.status).toBe(401)
    // missing required query → 422
    const b = await server.fetch(new Request('http://localhost/api/v1/q?k=t'))
    expect(b.status).toBe(422)
    // ok
    const c = await server.fetch(new Request('http://localhost/api/v1/q?k=t&page=2'))
    expect(c.status).toBe(200)
  })

  it('treats required body as missing when empty', async () => {
    const server = buildServer({ validation: { request: true } })
    const res = await server.fetch(
      new Request('http://localhost/api/v1/widgets', {
        method: 'POST',
        headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(422)
    const body = (await res.json()) as { violations: { path: string; keyword: string }[] }
    expect(body.violations.some((v) => v.path === '/body' && v.keyword === 'required')).toBe(true)
  })

  it('does not validate routes outside the OAS doc', async () => {
    const server = buildServer({ validation: { request: true } })
    const res = await server.fetch(new Request('http://localhost/api/v1/anything-else'))
    // Goes through the normal 404 path, not a validation envelope.
    expect(res.status).toBe(404)
  })
})
