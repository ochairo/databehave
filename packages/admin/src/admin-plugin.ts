import { capability, type Plugin } from '@databehave/core'
import { httpCapability, type RouteKey } from '@databehave/server'
import { createAdminRoutes } from './admin-routes.js'
import { faultControlCapability } from './fault-plugin.js'
import type { ScenariosStore } from './scenarios.js'
import { isAdminOriginAllowed, resolveAdminCors } from './resolve-cors.js'
import type { AdminModeCors } from './admin-types.js'

/** Admin presentation and explicitly scoped persistence. Presence opts into the feature. */
export interface AdminOptions {
  readonly path?: string
  readonly ui?: boolean
  readonly bind?: 'loopback-only' | 'any'
  readonly cors?: AdminModeCors
  /** Explicit storage provider; omission disables scenario endpoints. */
  readonly scenarios?: ScenariosStore
  /** Optional prepared document for rich UI details; never used to discover routes. */
  readonly openapiBody?: () => string | undefined
}

/** Presentation metadata available to optional browser-opening plugins. */
export interface AdminInfo {
  readonly path: string
  readonly ui: boolean
}

export const adminCapability = capability<AdminInfo>('databehave.admin', 1)

/** Register the admin REST API and optional assets, consuming HTTP and fault control. */
export const adminPlugin = (options: AdminOptions = {}): Plugin => {
  const path = (options.path ?? '/databehave').replace(/\/$/, '')
  if (!path.startsWith('/') || !/^\/[A-Za-z0-9_./~-]+$/.test(path) || path.includes('..')) {
    throw new Error('admin.path must start with "/" and contain safe URL path characters')
  }
  const bind = options.bind ?? 'loopback-only'
  const cors = options.cors ?? 'auto'
  const ownsPath = (requestPath: string): boolean => requestPath === path || requestPath.startsWith(`${path}/`)
  return {
    id: 'databehave.admin', apiVersion: 1,
    requires: [httpCapability, faultControlCapability], provides: [adminCapability],
    setup(ctx) {
      const http = ctx.use(httpCapability)
      const faults = ctx.use(faultControlCapability)
      faults.excludePathPrefix(path)
      ctx.provide(adminCapability, { path, ui: options.ui !== false })
      http.registerBindGuard({ owner: 'databehave.admin', check({ host }) {
        if (bind !== 'any' && host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
          throw new Error(`admin is enabled with loopback-only binding; refusing ${host}`)
        }
      } })
      http.registerMiddleware({ owner: 'databehave.admin', order: ctx.order, stage: 'preflight', handle(request) {
        if (!ownsPath(request.path)) return
        if (!isAdminOriginAllowed(bind, cors, request.headers.origin, request.url)) {
          return { status: 403, json: { error: 'Admin origin is not allowed' } }
        }
        if (request.method === 'options') {
          const target = http.resolveRoute(request.headers['access-control-request-method'] ?? 'options', request.path)
          return target ? { status: 204, empty: true } : { status: 404, json: { error: 'Admin route not found' } }
        }
      } })
      http.registerMiddleware({ owner: 'databehave.admin', order: ctx.order, stage: 'decoration', handle(request, response) {
        if (!ownsPath(request.path)) return
        const headers = new Headers(response.headers)
        for (const name of [...headers.keys()]) if (name.startsWith('access-control-')) headers.delete(name)
        if (isAdminOriginAllowed(bind, cors, request.headers.origin, request.url)) {
          for (const [name, value] of Object.entries(resolveAdminCors(bind, cors, request.headers.origin))) headers.set(name, value)
        }
        const vary = headers.get('vary')?.split(',').map(value => value.trim()) ?? []
        if (!vary.some(value => value.toLowerCase() === 'origin' || value === '*')) vary.push('Origin')
        headers.set('vary', vary.join(', '))
        return { ...response, headers: Object.fromEntries(headers) }
      } })
      const routes = createAdminRoutes({ store: faults, basePath: path,
        catalog: () => http.routes,
        ...(options.ui !== undefined ? { ui: options.ui } : {}),
        ...(options.openapiBody ? { openapiBody: options.openapiBody } : {}),
        ...(options.scenarios ? { scenarios: options.scenarios } : {}),
      })
      http.registerRoutes({ owner: 'databehave.admin', order: ctx.order, materialize: () =>
        (Object.keys(routes) as RouteKey[]).flatMap((key) => {
          const handler = routes[key]
          return handler ? [{ key, handler, priority: 'explicit' as const, source: 'admin', cors: false as const }] : []
        }),
      })
    },
  }
}
