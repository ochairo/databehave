import { createHost, type Plugin } from '@databehave/core'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { httpPlugin, httpCapability, nodeHttpPlugin, routesPlugin, corsPlugin, accessLogPlugin, type HttpRuntime, type NodeHttpOptions, type Handler } from '../src/index.js'

describe('public HTTP entry', () => {
  it('composes and serves HTTP through exported capabilities', async () => {
    const host = createHost({ plugins: [httpPlugin(), routesPlugin({ 'GET /public': () => ({ json: { public: true } }) }), corsPlugin()] })
    await host.start()
    try {
      const response = await host.get(httpCapability).fetch(new Request('http://localhost/public'))
      expect(await response.json()).toEqual({ public: true })
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
    } finally { await host.close() }
  })

  it('pins plugin factories, capability values and handler return types', () => {
    expectTypeOf(httpPlugin).returns.toEqualTypeOf<Plugin>()
    expectTypeOf(nodeHttpPlugin).parameter(0).toEqualTypeOf<NodeHttpOptions | undefined>()
    expectTypeOf(nodeHttpPlugin).returns.toEqualTypeOf<Plugin>()
    expectTypeOf(corsPlugin).returns.toEqualTypeOf<Plugin>()
    expectTypeOf(accessLogPlugin).returns.toEqualTypeOf<Plugin>()
    expectTypeOf<HttpRuntime['fetch']>().returns.toEqualTypeOf<Promise<Response>>()
    const handler: Handler = (request) => ({ json: { method: request.method, cancelled: request.signal.aborted } })
    expectTypeOf(routesPlugin).parameter(0).toMatchTypeOf<Readonly<Partial<Record<`GET /${string}`, Handler>>>>()
    expectTypeOf(handler).toEqualTypeOf<Handler>()
  })
})
