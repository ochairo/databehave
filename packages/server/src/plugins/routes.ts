import type { Plugin } from '@databehave/core'
import { httpCapability } from '../http.js'
import type { Handler, RouteKey } from '../types.js'

/** Register explicit handlers through the same contribution contract as external plugins. */
export const routesPlugin = (routes: Readonly<Partial<Record<RouteKey, Handler>>>, id = 'databehave.http.routes'): Plugin => ({
  id, apiVersion: 1, requires: [httpCapability],
  setup(ctx) {
    const entries = Object.entries(routes)
    ctx.use(httpCapability).registerRoutes({ owner: id, order: ctx.order, materialize: () => entries.flatMap(([key, handler]) => handler ? [{ key: key as RouteKey, handler, priority: 'explicit' as const }] : []) })
  },
})
