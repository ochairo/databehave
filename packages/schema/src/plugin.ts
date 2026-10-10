import { capability, type Capability, type Plugin } from '@databehave/core'
import { createSchemaRuntime, type SchemaRuntime, type SchemaRuntimeOptions } from './runtime/runtime.js'

/** Optional application capability; standalone schema imports never load the host. */
export const schemaCapability: Capability<SchemaRuntime> = capability<SchemaRuntime>(
  'databehave.schema.runtime',
  1,
)

/** Compose a new synchronous schema registry during each host's setup phase. */
export const schemaPlugin = (options: SchemaRuntimeOptions): Plugin => ({
  id: 'databehave.schema',
  apiVersion: 1,
  provides: [schemaCapability],
  setup(context) {
    context.provide(schemaCapability, createSchemaRuntime(options))
  },
})
