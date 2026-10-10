import { standardRuntime } from '../standard/runtime.js'
export { IR_VERSION, type SchemaEnvelope, type SchemaVisitor, type WalkPath } from '../runtime/runtime.js'
/** Standard preset traversal. Custom schemas use runtime.walkSchema. */
export const walkSchema = standardRuntime.walkSchema
/** Validate and rebuild through the standard kind descriptors. */
export const fromIR = standardRuntime.fromIR
export const serializeSchema = standardRuntime.serializeSchema
export const deserializeSchema = standardRuntime.deserializeSchema
