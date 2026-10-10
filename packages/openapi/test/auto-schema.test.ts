import { describe, expect, it, vi } from 'vitest'
import * as builders from '@databehave/schema'
import { createSchemaRuntime, standardKinds, standardBehaviors } from '@databehave/schema'
import { schemaGeneratorPlugin } from '../src/schema.js'
import { mockModePlugin } from '../src/index.js'
import { hashSeed } from '../src/openapi/auto-schema.js'
import { startOpenApi } from './helpers.js'

const runtime = createSchemaRuntime({ kinds: standardKinds, behaviors: standardBehaviors })
const user = {
  type: 'object', properties: {
    id: { type: 'integer', minimum: 1, maximum: 1000000 },
    name: { type: 'string', minLength: 3, maxLength: 24 },
  }, required: ['id', 'name'], additionalProperties: false,
}
const document = JSON.stringify({
  paths: {
    '/users/{id}': { get: { responses: {
      200: { content: { 'application/json': { schema: user } } },
      500: { content: { 'application/json': { schema: { type: 'object', properties: { errorId: { type: 'integer', minimum: 100, maximum: 999999 } }, required: ['errorId'] } } } },
    } } },
    '/items': { get: { responses: { 200: { content: { 'application/json': { schema: { type: 'array', items: user, minItems: 2, maxItems: 2 } } } } } } },
  },
})
const schema = (seed?: number | 'stable' | 'random') => schemaGeneratorPlugin({ builders, runtime, ...(seed !== undefined ? { seed } : {}) })

describe('explicit schema generation provider', () => {
  it('generates realistic object and array bodies through the supplied runtime', async () => {
    const http = await startOpenApi({ document, provider: schema() })
    const body = await (await http.fetch(new Request('http://x/users/a'))).json() as { id: number; name: string }
    expect(typeof body.id).toBe('number')
    expect(body.name).not.toBe('string')
    expect(Object.keys(body).sort()).toEqual(['id', 'name'])
    expect(await (await http.fetch(new Request('http://x/items'))).json()).toHaveLength(2)
  })

  it.each(['stable', 42] as const)('preserves deterministic seed %s', async seed => {
    const http = await startOpenApi({ document, provider: schema(seed) })
    const a = await (await http.fetch(new Request('http://x/users/a?page=1'))).text()
    const b = await (await http.fetch(new Request('http://x/users/a?page=1'))).text()
    expect(a).toBe(b)
  })

  it('stable seeding varies by path params and query, ignoring query key order', async () => {
    const http = await startOpenApi({ document, provider: schema() })
    const get = async (path: string) => (await http.fetch(new Request(`http://x${path}`))).text()
    expect(await get('/users/a?page=1&sort=x')).toBe(await get('/users/a?sort=x&page=1'))
    expect(await get('/users/a?page=1')).not.toBe(await get('/users/a?page=2'))
    expect(await get('/users/a')).not.toBe(await get('/users/b'))
  })

  it('random seeding samples per request', async () => {
    const http = await startOpenApi({ document, provider: schema('random') })
    let step = 0
    const random = vi.spyOn(Math, 'random').mockImplementation(() => (step += 0.37) % 1)
    try {
      expect(await (await http.fetch(new Request('http://x/users/a'))).text()).not.toBe(await (await http.fetch(new Request('http://x/users/a'))).text())
    } finally { random.mockRestore() }
  })

  it('uses schema generation for injected statuses from the same catalog', async () => {
    const http = await startOpenApi({ document, provider: schema(42), plugins: [mockModePlugin({ defaultStatus: 500 })] })
    const response = await http.fetch(new Request('http://x/users/a'))
    expect(response.status).toBe(500)
    const body = await response.json() as { errorId: number }
    expect(body.errorId).toBeGreaterThanOrEqual(100)
    expect(body.errorId).toBeLessThanOrEqual(999999)
  })

  it('explicit handlers take precedence over schema defaults', async () => {
    const http = await startOpenApi({ document, provider: schema(), routes: { 'GET /users/:id': () => ({ json: 'pinned' }) } })
    expect(await (await http.fetch(new Request('http://x/users/a'))).json()).toBe('pinned')
  })

  it('rejects unsupported response keywords at preparation, including injected statuses', async () => {
    await expect(startOpenApi({
      document: JSON.stringify({ paths: { '/x': { get: { responses: { 500: { content: { 'application/json': { schema: { type: 'object', if: { type: 'string' } } } } } } } } } }),
      provider: schema(),
    })).rejects.toThrow(/unsupported JSON Schema keyword: if/)
  })

  it('keeps placeholder generation independently selectable', async () => {
    const http = await startOpenApi({ document })
    expect(await (await http.fetch(new Request('http://x/users/a'))).json()).toEqual({ id: 1, name: 'string' })
  })

  it('retains the stable FNV-1a seed derivation', () => {
    expect(hashSeed('GET /users/:id|page=2|id=42')).toBe(hashSeed('GET /users/:id|page=2|id=42'))
    expect(hashSeed('a')).not.toBe(hashSeed('b'))
    expect(hashSeed('a') >>> 0).toBe(hashSeed('a'))
  })
})
