import type { Plugin } from '@databehave/core'
import { buildCorsResponseHeaders, buildPreflightResponse, mergeVary } from '../cors.js'
import { httpCapability } from '../http.js'
import type { CorsConfig, MockRequest } from '../types.js'

/** Apply application CORS only to resolved routes, honoring each route owner's policy. */
export const corsPlugin = (options: CorsConfig = {}): Plugin => ({
  id: 'databehave.http.cors', apiVersion: 1, requires: [httpCapability],
  setup(ctx) {
    const http = ctx.use(httpCapability)
    const policy = (request: MockRequest): CorsConfig | false => {
      const method = request.method === 'options'
        ? request.headers['access-control-request-method'] ?? 'options'
        : request.method
      const route = http.resolveRoute(method, request.path)
      return route ? route.cors ?? options : false
    }
    http.registerMiddleware({ owner: 'databehave.http.cors', order: ctx.order, stage: 'preflight', handle: (request) => {
      const selected = policy(request)
      if (request.method === 'options' && selected !== false) return buildPreflightResponse(selected, request)
    } })
    http.registerMiddleware({ owner: 'databehave.http.cors', order: ctx.order, stage: 'decoration', handle: (request, response) => {
      const selected = policy(request)
      if (selected === false) return
      const headers = new Headers(response.headers)
      for (const [name, value] of Object.entries(buildCorsResponseHeaders(selected, request))) {
        if (name === 'vary') headers.set(name, mergeVary(headers.get(name) ?? undefined, value))
        else if (!headers.has(name)) headers.set(name, value)
      }
      return { ...response, headers: Object.fromEntries(headers.entries()) }
    } })
  },
})
