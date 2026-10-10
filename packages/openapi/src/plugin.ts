import type { Capability, Plugin } from '@databehave/core'
import { httpCapability } from '@databehave/server'
import type { RouteDefinition } from '@databehave/server'
import { openapiCapability, openapiGeneratorCapability, prepareCatalog } from './catalog.js'
import type { OpenApiCatalog, OpenApiDiagnostics, OpenApiGenerator } from './catalog.js'
import { parseOpenApi } from './openapi/loader.js'

/** Raw JSON document text; applications explicitly own filesystem and network loading. */
export interface OpenApiOptions extends OpenApiDiagnostics {
  readonly document: string
  readonly generator?: Capability<OpenApiGenerator>
}

/** Publish a catalog and generated HTTP routes after all sources have prepared. */
export const openapiPlugin = (options: OpenApiOptions): Plugin => {
  let catalog: OpenApiCatalog | undefined
  const prepared = (): OpenApiCatalog => {
    if (!catalog) throw new Error('OpenAPI catalog is unavailable before preparation')
    return catalog
  }
  const generator = options.generator ?? openapiGeneratorCapability
  return {
    id: 'databehave.openapi', apiVersion: 1,
    requires: [httpCapability, generator], provides: [openapiCapability],
    setup(ctx) {
      ctx.provide(openapiCapability, {
        get document() { return prepared().document },
        get operations() { return prepared().operations },
        find: (method, path) => prepared().find(method, path),
        body: (operation, status, request) => prepared().body(operation, status, request),
      })
      ctx.use(httpCapability).registerRoutes({
        owner: 'databehave.openapi', order: ctx.order,
        materialize: () => prepared().operations.map((operation): RouteDefinition => ({
          key: operation.key, priority: 'generated', source: 'openapi',
          metadata: { summary: operation.definition.summary, operationId: operation.definition.operationId, responseStatuses: operation.responses.map(response => response.status) },
          handler: request => {
            const status = operation.successStatus
            if (status === 204 || status === 205) return { status, empty: true }
            const body = prepared().body(operation, status, request)
            return { status, json: body === undefined ? (operation.method === 'get' || operation.method === 'head' ? {} : { success: true, message: null }) : body }
          },
        })),
      })
    },
    async prepare(ctx) {
      catalog = await prepareCatalog(parseOpenApi(options.document), ctx.use(generator), options)
    },
  }
}
