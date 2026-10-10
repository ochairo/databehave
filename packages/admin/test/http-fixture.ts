import { createHost, type Plugin } from '@databehave/core'
import { httpPlugin, httpCapability, type RouteKey, type Handler, type MockRequest, type MockResponse } from '@databehave/server'

/** Exercise internal HTTP adapters through the real plugin host and pipeline. */
export const createHttpFixture = (options: {
  routes: Partial<Record<RouteKey, Handler>>
  hooks?: { onRequest: (request: MockRequest) => Promise<MockResponse | void> }
}) => {
  const contribution: Plugin = {
    id: 'test.routes', apiVersion: 1, requires: [httpCapability],
    setup(ctx) {
      const http = ctx.use(httpCapability)
      http.registerRoutes({ owner: 'test.routes', order: ctx.order, materialize: () =>
        (Object.keys(options.routes) as RouteKey[]).flatMap((key) => {
          const handler = options.routes[key]
          return handler ? [{ key, handler, priority: 'explicit' as const }] : []
        }),
      })
      if (options.hooks) http.registerMiddleware({ owner: 'test.routes', order: ctx.order, stage: 'interception', handle: options.hooks.onRequest })
    },
  }
  const host = createHost({ plugins: [httpPlugin(), contribution] })
  return { async fetch(request: Request) {
    await host.start()
    return host.get(httpCapability).fetch(request)
  }, close: () => host.close() }
}
