import type { GenContext } from '../foundation/axes.js'
import type { Issue } from '../foundation/errors.js'
import type { SchemaNode } from '../foundation/ir.js'
import type { Rng } from '../foundation/prng.js'
import { Schema } from '../foundation/types.js'
import type { ModifierProbs } from '../generator/engine.js'
import type { TraceEntry } from '../generator/trace.js'

/** A structural child and its traversal path segment. */
export interface SchemaChild {
  readonly key: string | number
  readonly node: SchemaNode
}
/** Candidate sampling scoped to one downstream generation continuation. */
export interface SamplingContext {
  readonly candidates: readonly unknown[]
  readonly fallback: () => unknown
}
/** Continue with the current sampling scope, or override it for this call only. */
export type GenerationNext = (sampling?: SamplingContext) => unknown
/** Services scoped to one generation call; recursion retains its runtime. */
export interface GenerationContext extends GenContext {
  readonly sampling?: SamplingContext
  readonly path: readonly (string | number)[]
  readonly rng: Rng
  readonly leafRng: () => Rng
  readonly modifierProbs: Required<ModifierProbs>
  readonly isDeferred: (node: SchemaNode) => boolean
  readonly generate: (
    node: SchemaNode,
    path: readonly (string | number)[],
    parent: Readonly<Record<string, unknown>>,
  ) => unknown
  readonly emit: (entry: TraceEntry) => void
}
/** Validation services scoped to a node; plugins report issues or recurse. */
export interface ValidationContext extends GenContext {
  readonly path: readonly (string | number)[]
  readonly issues: Issue[]
  readonly describe: (node: SchemaNode) => string
  readonly isDeferred: (node: SchemaNode) => boolean
  readonly check: (
    node: SchemaNode,
    value: unknown,
    path: readonly (string | number)[],
    issues: Issue[],
    root: unknown,
    parent: Readonly<Record<string, unknown>> | undefined,
  ) => unknown
}
/** A kind owns its complete structural and value contract. */
export interface KindDescriptor {
  readonly id: string
  readonly version: number
  readonly describe?: (node: SchemaNode, describeChild: (node: SchemaNode) => string) => string
  readonly checkMetadata: (node: unknown) => SchemaNode
  readonly generate: (node: SchemaNode, context: GenerationContext) => unknown
  readonly validate: (node: SchemaNode, value: unknown, context: ValidationContext) => unknown
  readonly children: (node: SchemaNode) => readonly SchemaChild[]
  readonly rebuild: (node: SchemaNode, children: readonly SchemaChild[]) => SchemaNode
}
/** Fixed phase barriers; composition order determines order within each phase. */
export type BehaviorPhase = 'modifier' | 'derived' | 'cadence' | 'invariant' | 'sample'
/** Behavior policy uses middleware so short circuits and bounded retries are explicit. */
export interface BehaviorDescriptor {
  readonly id: string
  readonly version: number
  readonly phase: BehaviorPhase
  readonly read: (node: SchemaNode) => unknown
  readonly write: (node: SchemaNode, metadata: unknown) => SchemaNode
  readonly checkMetadata: (metadata: unknown) => unknown
  readonly appliesTo: (node: SchemaNode, metadata: unknown) => boolean
  readonly merge: (previous: unknown, next: unknown) => unknown
  readonly generate: (
    metadata: unknown,
    node: SchemaNode,
    context: GenerationContext,
    next: GenerationNext,
  ) => unknown
  readonly validate: (
    metadata: unknown,
    node: SchemaNode,
    value: unknown,
    context: ValidationContext,
    next: () => unknown,
  ) => unknown
  readonly serialize: (metadata: unknown) => unknown
}
/** Typed public kind authoring; the parser validates every untrusted node. */
export interface KindDefinition<T, N extends SchemaNode> {
  readonly id: N['kind']
  readonly version: number
  readonly describe?: (node: N, describeChild: (node: SchemaNode) => string) => string
  readonly checkMetadata: (node: unknown) => N
  readonly generate: (node: N, context: GenerationContext) => T
  readonly validate: (node: N, value: unknown, context: ValidationContext) => unknown
  readonly children: (node: N) => readonly SchemaChild[]
  readonly rebuild: (node: N, children: readonly SchemaChild[]) => N
}
/** Kind descriptor with a type-safe builder; no builder subclass is required. */
export interface TypedKind<T, N extends SchemaNode> extends KindDescriptor {
  readonly schema: (metadata: Omit<N, 'kind'>) => Schema<T>
}
/** Erase only the validated metadata type at the registry boundary. */
export const defineKind = <T, N extends SchemaNode>(definition: KindDefinition<T, N>): TypedKind<T, N> => {
  const { id, version } = definition
  const read = definition.checkMetadata.bind(definition)
  const describe = definition.describe?.bind(definition)
  const generate = definition.generate.bind(definition)
  const validate = definition.validate.bind(definition)
  const children = definition.children.bind(definition)
  const rebuild = definition.rebuild.bind(definition)
  return Object.freeze({
    id,
    version,
    checkMetadata: read,
    ...(describe === undefined
      ? {}
      : {
          describe: (node: SchemaNode, child: (node: SchemaNode) => string) =>
            describe(read(node), child),
        }),
    generate: (node: SchemaNode, context: GenerationContext) => generate(read(node), context),
    validate: (node: SchemaNode, value: unknown, context: ValidationContext) =>
      validate(read(node), value, context),
    children: (node: SchemaNode) => children(read(node)),
    rebuild: (node: SchemaNode, children: readonly SchemaChild[]) => rebuild(read(node), children),
    schema: (metadata: Omit<N, 'kind'>) => new Schema<T>(read({ ...metadata, kind: id })),
  })
}
/** Typed behavior authoring with the common instance-independent metadata carrier. */
export interface BehaviorDefinition<M> {
  readonly id: string
  readonly version: number
  readonly phase: BehaviorPhase
  readonly checkMetadata: (metadata: unknown) => M
  readonly appliesTo: (node: SchemaNode, metadata: M) => boolean
  readonly merge: (previous: M, next: M) => M
  readonly generate: (
    metadata: M,
    node: SchemaNode,
    context: GenerationContext,
    next: GenerationNext,
  ) => unknown
  readonly validate: (
    metadata: M,
    node: SchemaNode,
    value: unknown,
    context: ValidationContext,
    next: () => unknown,
  ) => unknown
  readonly serialize: (metadata: M) => unknown
}
/** Behavior descriptor with a typed metadata attachment helper. */
export interface TypedBehavior<M> extends BehaviorDescriptor {
  readonly apply: <T>(schema: Schema<T>, metadata: M) => Schema<T>
}
/** Adapt typed metadata to the public behavior contract. */
export const defineBehavior = <M>(definition: BehaviorDefinition<M>): TypedBehavior<M> => {
  const { id, version, phase } = definition
  const read = definition.checkMetadata.bind(definition)
  const appliesTo = definition.appliesTo.bind(definition)
  const merge = definition.merge.bind(definition)
  const generate = definition.generate.bind(definition)
  const validate = definition.validate.bind(definition)
  const serialize = definition.serialize.bind(definition)
  const descriptor: BehaviorDescriptor = Object.freeze({
    id,
    version,
    phase,
    read: (node: SchemaNode) => node.mods?.behaviors?.[id],
    write: (node: SchemaNode, metadata: unknown): SchemaNode => ({
      ...node,
      mods: {
        ...node.mods,
        behaviors: { ...node.mods?.behaviors, [id]: read(metadata) },
      },
    }),
    checkMetadata: read,
    appliesTo: (node: SchemaNode, metadata: unknown) => appliesTo(node, read(metadata)),
    merge: (previous: unknown, next: unknown) => merge(read(previous), read(next)),
    generate: (metadata: unknown, node: SchemaNode, context: GenerationContext, next: GenerationNext) =>
      generate(read(metadata), node, context, next),
    validate: (
      metadata: unknown,
      node: SchemaNode,
      value: unknown,
      context: ValidationContext,
      next: () => unknown,
    ) => validate(read(metadata), node, value, context, next),
    serialize: (metadata: unknown) => serialize(read(metadata)),
  })
  return Object.freeze({
    ...descriptor,
    apply: <T>(schema: Schema<T>, metadata: M): Schema<T> => {
      const incoming = read(metadata)
      const previous = descriptor.read(schema._node)
      const merged = previous === undefined ? incoming : descriptor.merge(previous, incoming)
      if (!descriptor.appliesTo(schema._node, merged))
        throw new TypeError(`behavior ${descriptor.id} is not applicable to ${schema._node.kind}`)
      return new Schema<T>(descriptor.write(schema._node, merged))
    },
  })
}
