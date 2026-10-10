import { createHost, type Plugin } from '@databehave/core'
import { describe, expect, it } from 'vitest'
import { httpCapability, terminateTransport, UnsupportedTransportError, type HttpRuntime } from '../src/http.js'
import { httpPlugin } from '../src/server.js'
import { corsPlugin } from '../src/plugins/cors.js'
import { accessLogPlugin } from '../src/plugins/access-log.js'
import { routesPlugin } from '../src/plugins/routes.js'

const request = (method = 'GET', path = '/item'): Request => new Request(`http://localhost${path}`, { method })
const extension = (setup: (http: HttpRuntime, order: number) => void, id = 'extension'): Plugin => ({
  id, apiVersion: 1, requires: [httpCapability], setup: (ctx) => setup(ctx.use(httpCapability), ctx.order),
})

describe('plugin HTTP pipeline', () => {
  it('materializes prepared sources once, applies priority, and seals registration', async () => {
    let prepared = false
    let materializations = 0
    const generated: Plugin = {
      ...extension((http, order) => http.registerRoutes({ owner: 'generated', order, materialize: () => {
        expect(prepared).toBe(true)
        materializations++
        return [{ key: 'GET /item', priority: 'generated', handler: () => ({ text: 'generated' }) }]
      } }), 'generated'),
      prepare() { prepared = true },
    }
    const host = createHost({ plugins: [generated, routesPlugin({ 'GET /item': () => ({ text: 'explicit' }) }), httpPlugin()] })
    await host.start()
    const http = host.get(httpCapability)
    expect(await (await http.fetch(request())).text()).toBe('explicit')
    expect(http.routes).toHaveLength(1)
    expect(materializations).toBe(1)
    expect(() => http.registerRoutes({ owner: 'late', order: 0, materialize: () => [] })).toThrow('sealed')
    expect(() => http.registerMiddleware({ owner: 'late', order: 0, stage: 'observation', handle() {} })).toThrow('sealed')
    await host.close()
  })

  it('fails equal-priority conflicts with both contribution owners', async () => {
    const host = createHost({ plugins: [httpPlugin(), routesPlugin({ 'GET /item': () => ({ empty: true }) }, 'first'), routesPlugin({ 'GET /item': () => ({ empty: true }) }, 'second')] })
    await expect(host.start()).rejects.toThrow(/first.*second/)
  })

  it('selects exact before parameterized routes and uses composition order for parameter ties', async () => {
    const host = createHost({ plugins: [httpPlugin(), routesPlugin({
      'GET /:id': (req) => ({ text: req.params['id'] ?? '' }),
      'GET /item': () => ({ text: 'exact' }),
      'GET /:other': () => ({ text: 'later' }),
    })] })
    await host.start()
    expect(await (await host.get(httpCapability).fetch(request())).text()).toBe('exact')
    expect(await (await host.get(httpCapability).fetch(request('GET', '/dynamic'))).text()).toBe('dynamic')
    await host.close()
  })

  it('runs each phase once for HEAD and observes the original method with a stripped body', async () => {
    const calls: string[] = []
    const host = createHost({ plugins: [extension((http, order) => {
      for (const stage of ['preflight', 'validation', 'interception'] as const) http.registerMiddleware({ owner: stage, order, stage, handle: (req) => { calls.push(`${stage}:${req.method}`) } })
      http.registerMiddleware({ owner: 'decorate', order, stage: 'decoration', handle: (_req, res) => { calls.push('decorate'); return { ...res, headers: { decorated: 'yes' } } } })
      http.registerMiddleware({ owner: 'observe', order, stage: 'observation', handle: ({ request: req, outcome }) => { calls.push(`observe:${req.method}`); expect(outcome.kind === 'response' && outcome.response.body).toBeNull() } })
    }), httpPlugin(), routesPlugin({ 'GET /item': (req) => { calls.push(`handler:${req.effectiveMethod}`); return { text: 'body' } } })] })
    await host.start()
    const response = await host.get(httpCapability).fetch(request('HEAD'))
    expect(await response.text()).toBe('')
    expect(response.headers.get('decorated')).toBe('yes')
    expect(calls).toEqual(['preflight:head', 'validation:head', 'interception:head', 'handler:get', 'decorate', 'observe:head'])
    await host.close()
  })

  it('uses an explicit HEAD handler without invoking GET', async () => {
    const host = createHost({ plugins: [httpPlugin(), routesPlugin({ 'GET /item': () => { throw new Error('GET must not run') }, 'HEAD /item': () => ({ status: 202, text: 'head' }) })] })
    await host.start()
    const response = await host.get(httpCapability).fetch(request('HEAD'))
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
    await host.close()
  })

  it('decorates and logs preflight, validation short circuits, and handler errors once', async () => {
    const lines: string[] = []
    const host = createHost({ plugins: [httpPlugin(), corsPlugin(), accessLogPlugin({ write: (line) => { lines.push(line) } }), extension((http, order) => {
      http.registerMiddleware({ owner: 'validate', order, stage: 'validation', handle: (req) => req.path === '/invalid' ? { status: 422, text: 'invalid' } : undefined })
    }), routesPlugin({ 'GET /item': () => { throw new Error('handler failed') }, 'GET /invalid': () => ({ text: 'unreachable' }) })] })
    await host.start()
    for (const [method, path, status] of [['OPTIONS', '/item', 204], ['GET', '/invalid', 422], ['GET', '/item', 500]] as const) {
      const response = await host.get(httpCapability).fetch(new Request(`http://local${path}`, {
        method, ...(method === 'OPTIONS' ? { headers: { 'access-control-request-method': 'GET' } } : {}),
      }))
      expect(response.status).toBe(status)
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
    }
    expect(lines).toHaveLength(3)
    await host.close()
  })

  it('bounds decorator and error failures, and ignores observation failures', async () => {
    let decorations = 0
    let errors = 0
    let observations = 0
    const host = createHost({ plugins: [httpPlugin(), extension((http, order) => {
      http.registerMiddleware({ owner: 'decoration', order, stage: 'decoration', handle() { decorations++; throw new Error('decoration failed') } })
      http.registerMiddleware({ owner: 'error', order, stage: 'error', handle() { errors++; throw new Error('error handler failed') } })
      http.registerMiddleware({ owner: 'observation', order, stage: 'observation', handle() { observations++; throw new Error('observer failed') } })
    })] })
    await host.start()
    expect((await host.get(httpCapability).fetch(request())).status).toBe(500)
    expect([decorations, errors, observations]).toEqual([1, 1, 1])
    await host.close()
  })

  it('exposes termination as an explicit unsupported Fetch effect and observes it once', async () => {
    let observations = 0
    const host = createHost({ plugins: [httpPlugin(), routesPlugin({ 'GET /item': () => terminateTransport('test termination') }), extension((http, order) => {
      http.registerMiddleware({ owner: 'observer', order, stage: 'observation', handle: ({ outcome }) => { expect(outcome.kind).toBe('terminate'); observations++ } })
    })] })
    await host.start()
    await expect(host.get(httpCapability).fetch(request())).rejects.toBeInstanceOf(UnsupportedTransportError)
    expect(observations).toBe(1)
    await host.close()
  })

  it('preserves caller cancellation and handles reserved object property names', async () => {
    const host = createHost({ plugins: [httpPlugin(), routesPlugin({ 'GET /:__proto__': (req) => ({ json: { signal: req.signal.aborted, value: req.params['__proto__'], query: req.query['__proto__'] } }) })] })
    await host.start()
    const abort = new AbortController()
    abort.abort()
    await expect(host.get(httpCapability).fetch(new Request('http://localhost/value?__proto__=query', { signal: abort.signal }))).rejects.toThrow()
    const response = await host.get(httpCapability).fetch(new Request('http://localhost/value?__proto__=query'))
    expect(await response.json()).toEqual({ signal: false, value: 'value', query: 'query' })
    await host.close()
  })
})

it('route CORS policy owns preflight and decoration with router precedence', async () => {
  const host = createHost({ plugins: [httpPlugin(), corsPlugin(), extension((http, order) => {
    http.registerRoutes({ owner: 'policies', order, materialize: () => [
      { key: 'GET /items/:id', priority: 'explicit', handler: () => ({ text: 'parameter' }) },
      { key: 'GET /items/private', priority: 'explicit', cors: false, handler: () => ({ text: 'private' }) },
      { key: 'GET /items/allow', priority: 'explicit', cors: { origin: () => 'https://allowed.example' }, handler: () => ({ text: 'allowed' }) },
    ] })
  })] })
  await host.start()
  try {
    const http = host.get(httpCapability)
    expect(http.resolveRoute('HEAD', '/items/private')?.path).toBe('/items/private')
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const response = await http.fetch(new Request('http://local/items/private', {
        method, headers: { origin: 'https://foreign.example', 'access-control-request-method': 'GET' },
      }))
      expect(response.headers.has('access-control-allow-origin')).toBe(false)
      if (method === 'OPTIONS') expect(response.status).toBe(404)
    }
    expect((await http.fetch(new Request('http://local/items/allow'))).headers.get('access-control-allow-origin')).toBe('https://allowed.example')
    expect((await http.fetch(new Request('http://local/items/other'))).headers.get('access-control-allow-origin')).toBe('*')
    const unknown = await http.fetch(new Request('http://local/unknown', { method: 'OPTIONS', headers: { 'access-control-request-method': 'DELETE' } }))
    expect(unknown.status).toBe(404)
    expect(unknown.headers.has('access-control-allow-origin')).toBe(false)
  } finally { await host.close() }
})
