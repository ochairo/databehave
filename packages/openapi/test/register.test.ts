import { describe, expect, it } from 'vitest'
import { prepareCatalog } from '../src/catalog.js'
import { placeholderGenerator } from '../src/placeholder.js'
import { startOpenApi } from './helpers.js'
import { mockModePlugin } from '../src/index.js'

const json = (schema: unknown) => ({ content: { 'application/json': { schema } } })
const document = (paths: Record<string, unknown>) => JSON.stringify({ paths })

describe('one prepared operation and response catalog', () => {
  it('registers parameterized and root paths, ignoring unsupported methods', async () => {
    const http = await startOpenApi({ document: document({
      '/': { get: { responses: { 200: json({ const: 'root' }) } } },
      '/u/{id}': { get: { responses: { 200: json({ const: 'user' }) } }, trace: {} },
    }) })
    expect(http.routes.map(route => route.key)).toEqual(['GET /', 'GET /u/:id'])
    expect(await (await http.fetch(new Request('http://x/'))).json()).toBe('root')
    expect(await (await http.fetch(new Request('http://x/u/1'))).json()).toBe('user')
  })

  it('prefers 200, otherwise the smallest declared 2xx, and returns that status', async () => {
    const http = await startOpenApi({ document: document({
      '/a': { post: { responses: { 201: json({ const: 'created' }), 200: json({ const: 'ok' }) } } },
      '/b': { post: { responses: { 202: json({ const: 'later' }), 201: json({ const: 'created' }) } } },
    }) })
    const a = await http.fetch(new Request('http://x/a', { method: 'POST' }))
    const b = await http.fetch(new Request('http://x/b', { method: 'POST' }))
    expect([a.status, await a.json()]).toEqual([200, 'ok'])
    expect([b.status, await b.json()]).toEqual([201, 'created'])
  })

  it.each([204, 205])('serves no body for %s', async status => {
    const http = await startOpenApi({ document: document({ '/d': { delete: { responses: { [status]: json({ const: 'ignored' }) } } } }) })
    const response = await http.fetch(new Request('http://x/d', { method: 'DELETE' }))
    expect(response.status).toBe(status)
    expect(await response.text()).toBe('')
  })

  it('reports permissive schemas and generation errors once, preserving stubs', async () => {
    const empty: number[] = []
    const failures: unknown[] = []
    const http = await startOpenApi({
      document: document({ '/empty': { get: { responses: { 200: json({}) } } }, '/bad': { get: { responses: { 200: json({ type: 'mystery' }) } } } }),
      onEmptySchema: (_method, _path, status) => empty.push(status),
      onWalkError: (_method, _path, error) => failures.push(error),
    })
    expect(empty).toEqual([200])
    expect(failures).toHaveLength(1)
    expect(await (await http.fetch(new Request('http://x/bad'))).json()).toEqual({})
  })

  it('uses the same exact-path precedence for injected bodies and normal routes', async () => {
    const http = await startOpenApi({
      document: document({
        '/u/{id}': { get: { responses: { 500: json({ const: 'parameter' }) } } },
        '/u/me': { get: { responses: { 500: json({ const: 'exact' }) } } },
      }),
      plugins: [mockModePlugin({ defaultStatus: 500 })],
    })
    expect(await (await http.fetch(new Request('http://x/u/me'))).json()).toBe('exact')
    expect(await (await http.fetch(new Request('http://x/u/other'))).json()).toBe('parameter')
  })

  it('rejects status suffixes and preserves fallback for missing/non-JSON/error schemas', async () => {
    const http = await startOpenApi({
      document: document({ '/x': { get: { responses: { '200garbage': json({ const: 'wrong' }), default: json({}), 500: { content: { 'text/plain': { schema: { type: 'string' } } } } } } } }),
      plugins: [mockModePlugin({ defaultStatus: 500 })],
    })
    expect(await (await http.fetch(new Request('http://x/x'))).json()).toEqual({ error: true, status: 500 })
    expect((await prepareCatalog({}, placeholderGenerator())).operations).toEqual([])
  })
})

describe('literal response schemas', () => {
  it('retains standalone example values, including null, through catalog preparation', async () => {
    const http = await startOpenApi({ document: document({
      '/example': { get: { responses: { 200: json({ example: 'literal' }) } } },
      '/null': { get: { responses: { 200: json({ example: null }) } } },
    }) })
    expect(await (await http.fetch(new Request('http://x/example'))).json()).toBe('literal')
    expect(await (await http.fetch(new Request('http://x/null'))).json()).toBeNull()
  })
})
