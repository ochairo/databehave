import type { Plugin } from '@databehave/core'
import { httpCapability } from '@databehave/server'
import { openapiCapability } from './catalog.js'
import { buildMockModeHooks } from './mock-mode.js'
import type { MockModeOptions } from './mock-mode.js'
export type { MockModeOptions } from './mock-mode.js'

export const mockModePlugin = (options: MockModeOptions = {}): Plugin => ({
  id: 'databehave.openapi.mock-mode', apiVersion: 1,
  requires: [httpCapability, openapiCapability],
  setup(ctx) {
    const catalog = ctx.use(openapiCapability)
    const runtime = ctx.use(httpCapability)
    const hooks = buildMockModeHooks({ ...options, enabled: true }, (request, status) => {
      const operation = catalog.find(request.effectiveMethod, request.path)
      return operation ? catalog.body(operation, status, request) : undefined
    })
    if (!hooks) throw new Error('Mock mode configuration failed')
    runtime.registerMiddleware({ owner: 'databehave.openapi.mock-mode', order: ctx.order, stage: 'interception', handle: hooks.onRequest })
    runtime.registerMiddleware({ owner: 'databehave.openapi.mock-mode', order: ctx.order, stage: 'decoration', handle: hooks.onResponse })
  },
})
