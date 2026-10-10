import { createHost, type Host, type Plugin } from '@databehave/core'
import { afterEach } from 'vitest'
import { httpPlugin, httpCapability, nodeHttpPlugin, listenerCapability, routesPlugin, corsPlugin, type Handler, type RouteKey, type CorsConfig, type MockRequest, type MockResponse, type NodeHttpOptions } from '../../src/index.js'

/** Test-only shorthand retaining HTTP characterization cases through public plugin composition. */
export interface HttpFixtureOptions {
  readonly routes?: Readonly<Partial<Record<RouteKey, Handler>>>
  readonly cors?: CorsConfig
  readonly plugins?: readonly Plugin[]
  readonly hooks?: {
    readonly onRequest?: (request: MockRequest) => MockResponse | void | Promise<MockResponse | void>
    readonly onResponse?: (request: MockRequest, response: MockResponse) => MockResponse | void | Promise<MockResponse | void>
    readonly onError?: (request: MockRequest, error: unknown) => MockResponse | Promise<MockResponse>
    readonly onServerError?: (error: Error) => void
  }
}

/** Test listener address and ownership; closing a host is terminal. */
export interface FixtureListener {
  readonly host: string
  readonly port: number
  close(): Promise<void>
}

/** Lazy test composition keeps fetch-only cases free of sockets. */
export interface HttpFixture {
  start(): Promise<void>
  fetch(request: Request): Promise<Response>
  listen(options?: NodeHttpOptions): Promise<FixtureListener>
}

const hosts = new Set<Host>()
afterEach(async () => {
  const pending = [...hosts]
  hosts.clear()
  await Promise.all(pending.map((host) => host.close()))
})

export const createHttpFixture = (options: HttpFixtureOptions = {}): HttpFixture => {
  let host: Host | undefined
  const compose = (listener?: NodeHttpOptions): Host => {
    const hooks: Plugin = {
      id: 'test.hooks', apiVersion: 1, requires: [httpCapability],
      setup(ctx) {
        const http = ctx.use(httpCapability)
        const configured = options.hooks
        if (configured?.onRequest) http.registerMiddleware({ owner: 'test.hooks', order: ctx.order, stage: 'interception', handle: configured.onRequest })
        if (configured?.onResponse) http.registerMiddleware({ owner: 'test.hooks', order: ctx.order, stage: 'decoration', handle: configured.onResponse })
        if (configured?.onError) http.registerMiddleware({ owner: 'test.hooks', order: ctx.order, stage: 'error', handle: configured.onError })
      },
    }
    const plugins = [httpPlugin(), routesPlugin(options.routes ?? {}), hooks, ...(options.plugins ?? [])]
    if (options.cors) plugins.push(corsPlugin(options.cors))
    if (listener) plugins.push(nodeHttpPlugin({ ...listener, ...(options.hooks?.onServerError ? { onServerError: options.hooks.onServerError } : {}) }))
    const instance = createHost({ plugins })
    hosts.add(instance)
    return instance
  }
  return {
    async start() { host ??= compose(); await host.start() },
    async fetch(request) {
      host ??= compose()
      await host.start()
      return host.get(httpCapability).fetch(request)
    },
    async listen(listener = {}) {
      if (host) throw new Error('A test fixture may start only once; create a fresh fixture to listen again')
      host = compose(listener)
      await host.start()
      const address = host.get(listenerCapability).address
      if (!address) throw new Error('Test HTTP listener did not open')
      const instance = host
      return { ...address, close: () => instance.close() }
    },
  }
}
