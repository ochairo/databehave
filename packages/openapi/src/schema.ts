import type { Plugin } from '@databehave/core'
import type { SchemaRuntime } from '@databehave/schema'
import { openapiGeneratorCapability } from './catalog.js'
import type { OpenApiGenerator } from './catalog.js'
import { translateOasToIR } from './openapi/translate.js'
import type { SchemaBuilderApi } from './openapi/translate.js'
import { hashSeed } from './openapi/auto-schema.js'

export type { OpenApiGenerator, OpenApiGenerationContext, OpenApiOperation, OpenApiResponse, OpenApiBodyGenerator } from './catalog.js'
export type { OasDoc, OasNode } from './openapi/walker.js'

export { translateOasToIR, type SchemaBuilderApi } from './openapi/translate.js'

/** Explicit builders plus an instance-scoped runtime; no implicit imports or standard registry. */
export interface SchemaGeneratorOptions {
  readonly builders: SchemaBuilderApi
  readonly runtime: Pick<SchemaRuntime, 'mock'>
  readonly seed?: number | 'stable' | 'random'
}

const sortedJoin = (record: Readonly<Record<string, string>>): string =>
  Object.keys(record).sort().map(key => `${key}=${record[key]}`).join('&')

/** Schema generation fails during preparation if any declared response schema is unsupported. */
export const schemaGenerator = (options: SchemaGeneratorOptions): OpenApiGenerator => ({
  failureMode: 'throw',
  async compile(schema, { document, operation }) {
    const ir = await translateOasToIR(schema, document, options.builders)
    return request => {
      const setting = options.seed ?? 'stable'
      const seed = typeof setting === 'number' ? setting >>> 0 : setting === 'random'
        ? (Math.random() * 0xffffffff) >>> 0
        : hashSeed(`${operation.method.toUpperCase()} ${operation.path}|${sortedJoin(request.query)}|${sortedJoin(request.params)}`)
      return options.runtime.mock(ir, { seed })
    }
  },
})

/** Replace the placeholder provider with schema-backed generation for every catalog response. */
export const schemaGeneratorPlugin = (options: SchemaGeneratorOptions): Plugin => ({
  id: 'databehave.openapi.schema', apiVersion: 1,
  provides: [openapiGeneratorCapability],
  setup(ctx) { ctx.provide(openapiGeneratorCapability, schemaGenerator(options)) },
})
