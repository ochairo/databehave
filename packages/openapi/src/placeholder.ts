import type { Plugin } from '@databehave/core'
import { openapiGeneratorCapability } from './catalog.js'
import type { OpenApiGenerator } from './catalog.js'
import { generateFromOasSchema } from './openapi/generate.js'

/** Structural deterministic placeholders, with diagnostic fallback for unsupported schemas. */
export const placeholderGenerator = (): OpenApiGenerator => ({
  failureMode: 'fallback',
  compile(schema, { document }) {
    const body = generateFromOasSchema(schema, document)
    return () => body
  },
})

/** Explicit default provider; omit it when supplying a replacement provider. */
export const placeholderGeneratorPlugin = (): Plugin => ({
  id: 'databehave.openapi.placeholder', apiVersion: 1,
  provides: [openapiGeneratorCapability],
  setup(ctx) { ctx.provide(openapiGeneratorCapability, placeholderGenerator()) },
})
