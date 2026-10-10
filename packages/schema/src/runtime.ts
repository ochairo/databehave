/** Synchronous standalone composition; no application host or transport dependency. */
export { createSchemaRuntime, IR_VERSION, type SchemaRuntime, type SchemaRuntimeOptions, type SchemaContract, type SchemaEnvelope, type SchemaVisitor, type WalkPath, type RuntimeReplay } from './runtime/runtime.js'
export { defineKind, defineBehavior, type KindDescriptor, type KindDefinition, type TypedKind, type BehaviorDescriptor, type BehaviorDefinition, type TypedBehavior, type BehaviorPhase, type SchemaChild, type GenerationContext, type GenerationNext, type SamplingContext, type ValidationContext } from './runtime/contracts.js'
export { Schema, type Infer } from './foundation/types.js'
export type { SchemaNode, Modifiers } from './foundation/ir.js'
export type { MockOptions } from './generator/engine.js'
