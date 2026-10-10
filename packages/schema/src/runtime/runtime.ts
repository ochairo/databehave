import { generateDataset, type DatasetOptions } from '../dataset/generate.js'
import { ConformError, SchemaConflictError } from '../foundation/errors.js'
import type { Issue } from '../foundation/errors.js'
import type { SchemaNode } from '../foundation/ir.js'
import { mulberry32, rngFromString, seedFromString } from '../foundation/prng.js'
import { Schema, type Infer } from '../foundation/types.js'
import type { MockOptions } from '../generator/engine.js'
import type { TraceEntry } from '../generator/trace.js'
import type { SafeParseResult } from '../validator/parse.js'
import type { BehaviorDescriptor, KindDescriptor, GenerationContext, ValidationContext } from './contracts.js'

/** Descriptor identity included in serialized data and trace/replay evidence. */
export interface SchemaContract {
  readonly id: string
  readonly version: number
}
/** Runtime composition is explicit and sealed synchronously. */
export interface SchemaRuntimeOptions {
  readonly kinds: readonly KindDescriptor[]
  readonly behaviors: readonly BehaviorDescriptor[]
}
/** Traversal path relative to the root schema. */
export type WalkPath = readonly (string | number)[]
/** Traversal callbacks may skip a subtree by returning false from enter. */
export interface SchemaVisitor {
  readonly enter?: (node: SchemaNode, path: WalkPath) => void | boolean
  readonly leave?: (node: SchemaNode, path: WalkPath) => void
}
/** Version 2 records all required extension contracts. */
export const IR_VERSION = 2 as const
/** Portable schema envelope with exact kind and behavior contract versions. */
export interface SchemaEnvelope {
  readonly $databehaveVersion: typeof IR_VERSION
  readonly contracts: {
    readonly kinds: readonly SchemaContract[]
    readonly behaviors: readonly SchemaContract[]
  }
  readonly node: SchemaNode
}
/** Replay retains the runtime closure and a snapshot of caller options. */
export interface RuntimeReplay<S extends Schema> {
  (): Infer<S>
  readonly options: Readonly<MockOptions>
  readonly contracts: SchemaEnvelope['contracts']
}
/** Pure, synchronous schema operations bound to a sealed registry instance. */
export interface SchemaRuntime {
  readonly mockDataset: <S extends Schema>(options: DatasetOptions<S>) => Infer<S>[]
  readonly mock: <S extends Schema>(schema: S, options?: MockOptions) => Infer<S>
  readonly parse: <S extends Schema>(schema: S, value: unknown) => Infer<S>
  readonly safeParse: <S extends Schema>(schema: S, value: unknown) => SafeParseResult<Infer<S>>
  readonly withBehavior: <T>(schema: Schema<T>, id: string, metadata: unknown) => Schema<T>
  readonly walkSchema: (schema: Schema | SchemaNode, visitor: SchemaVisitor) => void
  readonly fromIR: (node: unknown) => Schema<unknown>
  readonly serializeSchema: (schema: Schema) => SchemaEnvelope
  readonly deserializeSchema: (envelope: unknown) => Schema<unknown>
  readonly replay: <S extends Schema>(schema: S, options?: MockOptions) => RuntimeReplay<S>
}
/** Require plain records at all external metadata boundaries. */
const record = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('expected metadata object')
  const proto: unknown = Object.getPrototypeOf(value)
  if (proto !== null && proto !== Object.prototype) throw new TypeError('expected plain metadata object')
  return value as Record<string, unknown>
}
/** Copy JSON data without lossy coercion, closure stripping or prototype setters. */
const copyJSON = (value: unknown, seen = new Set<object>()): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'object')
    throw new TypeError('schema serialization requires JSON data (closures are unsupported)')
  if (seen.has(value)) throw new TypeError('cyclic schema data')
  seen.add(value)
  const result: unknown = Array.isArray(value)
    ? value.map((item) => copyJSON(item, seen))
    : Object.fromEntries(Object.entries(record(value)).map(([key, item]) => [key, copyJSON(item, seen)]))
  seen.delete(value)
  return result
}
const identity = (descriptor: SchemaContract): SchemaContract => ({
  id: descriptor.id,
  version: descriptor.version,
})
const phases = ['modifier', 'derived', 'cadence', 'invariant', 'sample'] as const
/** Validate and snapshot descriptors; caller mutations cannot change the registry. */
export const createSchemaRuntime = (options: SchemaRuntimeOptions): SchemaRuntime => {
  const registry = <D extends SchemaContract>(
    items: readonly D[],
    handlers: readonly string[],
    snapshot: (descriptor: D) => D,
  ): ReadonlyMap<string, D> => {
    const result = new Map<string, D>()
    for (const descriptor of items) {
      if (
        typeof descriptor.id !== 'string' ||
        !/^[a-zA-Z][\w./-]*$/.test(descriptor.id) ||
        !Number.isSafeInteger(descriptor.version) ||
        descriptor.version < 1
      )
        throw new TypeError('invalid schema contract identity')
      if (result.has(descriptor.id)) throw new TypeError(`duplicate schema contract ${descriptor.id}`)
      for (const handler of handlers)
        if (typeof Reflect.get(descriptor, handler) !== 'function')
          throw new TypeError(`${descriptor.id}: missing handler ${handler}`)
      result.set(descriptor.id, Object.freeze(snapshot(descriptor)))
    }
    return result
  }
  const kinds = registry(options.kinds, ['checkMetadata', 'generate', 'validate', 'children', 'rebuild'],
    (descriptor) => {
      const describe = descriptor.describe
      if (describe !== undefined && typeof describe !== 'function')
        throw new TypeError(`${descriptor.id}: invalid describe handler`)
      return {
        id: descriptor.id,
        version: descriptor.version,
        ...(describe === undefined ? {} : { describe: describe.bind(descriptor) }),
        checkMetadata: descriptor.checkMetadata.bind(descriptor),
        generate: descriptor.generate.bind(descriptor),
        validate: descriptor.validate.bind(descriptor),
        children: descriptor.children.bind(descriptor),
        rebuild: descriptor.rebuild.bind(descriptor),
      }
    })
  const behaviors = registry(options.behaviors, [
    'read',
    'write',
    'checkMetadata',
    'appliesTo',
    'merge',
    'generate',
    'validate',
    'serialize',
  ], (descriptor) => ({
    id: descriptor.id,
    version: descriptor.version,
    phase: descriptor.phase,
    read: descriptor.read.bind(descriptor),
    write: descriptor.write.bind(descriptor),
    checkMetadata: descriptor.checkMetadata.bind(descriptor),
    appliesTo: descriptor.appliesTo.bind(descriptor),
    merge: descriptor.merge.bind(descriptor),
    generate: descriptor.generate.bind(descriptor),
    validate: descriptor.validate.bind(descriptor),
    serialize: descriptor.serialize.bind(descriptor),
  }))
  for (const descriptor of behaviors.values())
    if (!phases.includes(descriptor.phase)) throw new TypeError(`unknown behavior phase ${descriptor.phase}`)
  const ordered = [...behaviors.values()].sort((a, b) => phases.indexOf(a.phase) - phases.indexOf(b.phase))
  const kindOf = (node: SchemaNode): KindDescriptor => {
    const descriptor = kinds.get(node.kind)
    if (descriptor === undefined) throw new TypeError(`missing schema kind ${node.kind}`)
    return descriptor
  }
  const active = (node: SchemaNode): readonly { descriptor: BehaviorDescriptor; metadata: unknown }[] => {
    const entries = ordered.flatMap((descriptor) => {
      const raw = descriptor.read(node)
      if (raw === undefined) return []
      const metadata = descriptor.checkMetadata(raw)
      if (!descriptor.appliesTo(node, metadata))
        throw new TypeError(`behavior ${descriptor.id} is not applicable to ${node.kind}`)
      return [{ descriptor, metadata }]
    })
    // Every carried metadata entry needs its handler, including standard axes.
    for (const carrier of [node.mods?.axes, node.mods?.behaviors])
      if (carrier !== undefined) {
        for (const key of Object.keys(record(carrier)))
          if (!entries.some((e) => e.descriptor.id === key))
            throw new TypeError(`missing schema behavior ${key}`)
      }
    if (node.mods !== undefined) {
      const keys = Object.keys(record(node.mods)).filter((key) => key !== 'axes' && key !== 'behaviors')
      if (keys.length > 0 && !entries.some((e) => e.descriptor.id === 'modifiers'))
        throw new TypeError('missing schema behavior modifiers')
    }
    return entries
  }
  const validateTree = (input: unknown, ancestors = new Set<object>()): SchemaNode => {
    const raw = record(input)
    if (typeof raw.kind !== 'string') throw new TypeError('schema kind must be a string')
    if (ancestors.has(raw)) throw new TypeError('cyclic schema tree')
    ancestors.add(raw)
    const descriptor = kinds.get(raw.kind)
    if (descriptor === undefined) throw new TypeError(`missing schema kind ${raw.kind}`)
    const node = descriptor.checkMetadata(raw)
    if (node.kind !== descriptor.id) throw new TypeError(`kind ${descriptor.id} returned mismatched metadata`)
    active(node)
    const children = descriptor.children(node).map(({ key, node: child }) => {
      if (typeof key !== 'string' && typeof key !== 'number') throw new TypeError('invalid child path')
      return { key, node: validateTree(child, ancestors) }
    })
    ancestors.delete(raw)
    return descriptor.rebuild(node, children)
  }
  const walk = (node: SchemaNode, visitor: SchemaVisitor, path: WalkPath): void => {
    if (visitor.enter?.(node, path) !== false)
      for (const child of kindOf(node).children(node)) walk(child.node, visitor, [...path, child.key])
    visitor.leave?.(node, path)
  }
  const contracts = (node: SchemaNode): SchemaEnvelope['contracts'] => {
    const usedKinds = new Map<string, SchemaContract>()
    const usedBehaviors = new Map<string, SchemaContract>()
    walk(
      node,
      {
        enter: (current) => {
          const kind = kindOf(current)
          usedKinds.set(kind.id, identity(kind))
          for (const { descriptor } of active(current)) usedBehaviors.set(descriptor.id, identity(descriptor))
        },
      },
      [],
    )
    return {
      kinds: [...usedKinds.values()],
      behaviors: [...usedBehaviors.values()],
    }
  }
  const isDeferred = (node: SchemaNode): boolean =>
    active(node).some((entry) => entry.descriptor.phase === 'derived')
  const describe = (node: SchemaNode): string => kindOf(node).describe?.(node, describe) ?? node.kind
  const mock = <S extends Schema>(schema: S, options: MockOptions = {}): Infer<S> => {
    const node = validateTree(schema._node)
    const seed = String(options.seed ?? 'databehave')
    const factory = options.prng ?? mulberry32
    const rng = typeof options.seed === 'number' ? factory(options.seed) : factory(seedFromString(seed))
    const modifierProbs = {
      default: 0,
      optional: 0,
      nullable: 0,
      ...options.modifierProbs,
    }
    for (const [key, value] of Object.entries(modifierProbs))
      if (!(value >= 0 && value <= 1))
        throw new RangeError(`modifierProbs.${key} must be in [0, 1], got ${value}`)
    const generate = (
      current: SchemaNode,
      path: WalkPath,
      parent: Readonly<Record<string, unknown>>,
    ): unknown => {
      const entries = active(current)
      let emitted: TraceEntry | undefined
      const index = [...path].reverse().find((segment) => typeof segment === 'number') ?? options.index
      const context: GenerationContext = {
        root: undefined,
        parent,
        seed: `${seed}:${path.join('.')}`,
        path,
        rng,
        modifierProbs,
        generate,
        isDeferred,
        ...(typeof index === 'number' ? { index } : {}),
        ...(options.input === undefined ? {} : { input: options.input }),
        leafRng: () => {
          const stable = options.stableBy?.(context)
          return stable == null || stable === '' ? rng : rngFromString(`${stable}:${path.join('.')}`)
        },
        emit: (entry) => {
          emitted = entry
        },
      }
      const invoke = (i: number, scoped: GenerationContext): unknown => {
        const entry = entries[i]
        if (entry !== undefined)
          return entry.descriptor.generate(entry.metadata, current, scoped, (sampling) =>
            invoke(i + 1, sampling === undefined ? scoped : { ...scoped, sampling }))
        if (scoped.sampling !== undefined) return scoped.sampling.fallback()
        scoped.emit({ path, axis: 'type' })
        return kindOf(current).generate(current, scoped)
      }
      let succeeded = false
      try {
        const value = invoke(0, context)
        succeeded = true
        return value
      } finally {
        if (emitted !== undefined && (succeeded || emitted.axis === 'invariant-fail'))
          options.trace?.emit({
            ...emitted,
            contracts: {
              kind: identity(kindOf(current)),
              behaviors: entries.map((e) => identity(e.descriptor)),
            },
          })
      }
    }
    return generate(node, [], Object.freeze({})) as Infer<S>
  }
  const check = (
    node: SchemaNode,
    value: unknown,
    path: WalkPath,
    issues: Issue[],
    root: unknown,
    parent: Readonly<Record<string, unknown>> | undefined,
  ): unknown => {
    const context: ValidationContext = {
      root,
      parent: parent ?? Object.freeze({}),
      seed: `parse:${path.join('.')}`,
      path,
      issues,
      check,
      describe,
      isDeferred,
    }
    const entries = active(node)
    const invoke = (i: number): unknown => {
      const entry = entries[i]
      return entry === undefined
        ? kindOf(node).validate(node, value, context)
        : entry.descriptor.validate(entry.metadata, node, value, context, () => invoke(i + 1))
    }
    return invoke(0)
  }
  const safeParse = <S extends Schema>(schema: S, value: unknown): SafeParseResult<Infer<S>> => {
    const node = validateTree(schema._node)
    const issues: Issue[] = []
    const out = check(node, value, [], issues, undefined, undefined)
    return issues.length === 0
      ? { ok: true, value: out as Infer<S> }
      : { ok: false, error: new ConformError(issues) }
  }
  const serializeSchema = (schema: Schema): SchemaEnvelope => {
    const node = validateTree(schema._node)
    const encode = (current: SchemaNode, path: WalkPath): SchemaNode => {
      let next = kindOf(current).rebuild(
        current,
        kindOf(current)
          .children(current)
          .map((child) => ({
            ...child,
            node: encode(child.node, [...path, child.key]),
          })),
      )
      for (const { descriptor, metadata } of active(current)) {
        try {
          const encoded = descriptor.serialize(metadata)
          copyJSON(metadata)
          next = descriptor.write(next, encoded)
        } catch (error) {
          if (error instanceof SchemaConflictError)
            throw new SchemaConflictError(error.message, [...path, ...error.path], undefined, error.code)
          throw error
        }
      }
      return next
    }
    const encoded = copyJSON(encode(node, []))
    return {
      $databehaveVersion: IR_VERSION,
      contracts: contracts(node),
      node: validateTree(encoded),
    }
  }
  const runtime: SchemaRuntime = {
    mock,
    safeParse,
    mockDataset: (options) => generateDataset(options, mock),
    parse: (schema, value) => {
      const result = safeParse(schema, value)
      if (!result.ok) throw result.error
      return result.value
    },
    withBehavior: (schema, id, metadata) => {
      const descriptor = behaviors.get(id)
      if (descriptor === undefined) throw new TypeError(`missing schema behavior ${id}`)
      const incoming = descriptor.checkMetadata(metadata)
      const previous = descriptor.read(schema._node)
      const merged = previous === undefined ? incoming : descriptor.merge(previous, incoming)
      return new Schema(validateTree(descriptor.write(schema._node, merged)))
    },
    fromIR: (node) => new Schema(validateTree(node)),
    walkSchema: (schema, visitor) =>
      walk(validateTree(schema instanceof Schema ? schema._node : schema), visitor, []),
    serializeSchema,
    deserializeSchema: (input) => {
      if (input === null || typeof input !== 'object' || Array.isArray(input))
        throw new TypeError('expected an envelope object')
      const envelope = record(input)
      if (envelope.$databehaveVersion !== IR_VERSION) throw new TypeError('incompatible IR version')
      if (envelope.node === null || typeof envelope.node !== 'object')
        throw new TypeError('envelope.node must be an IR object')
      const claimed = record(envelope.contracts)
      for (const [name, available] of [
        ['kinds', kinds],
        ['behaviors', behaviors],
      ] as const) {
        const entries = claimed[name]
        if (!Array.isArray(entries)) throw new TypeError(`missing ${name} contracts`)
        const seen = new Set<string>()
        for (const item of entries) {
          const contract = record(item)
          if (typeof contract.id !== 'string' || seen.has(contract.id))
            throw new TypeError('invalid or duplicate serialized contract')
          seen.add(contract.id)
          const actual = available.get(contract.id)
          if (actual === undefined || actual.version !== contract.version)
            throw new TypeError(`missing or incompatible ${name} contract ${contract.id}`)
        }
      }
      const node = validateTree(copyJSON(envelope.node))
      const required = contracts(node)
      for (const name of ['kinds', 'behaviors'] as const) {
        const entries = claimed[name] as readonly SchemaContract[]
        if (
          entries.length !== required[name].length ||
          required[name].some((c) => !entries.some((e) => e.id === c.id && e.version === c.version))
        )
          throw new TypeError(`incorrect serialized ${name} contracts`)
      }
      return new Schema(node)
    },
    replay: (schema, options = {}) => {
      const node = deepFreeze(snapshot(validateTree(schema._node))) as SchemaNode
      const frozen = Object.freeze({
        ...options,
        ...(options.modifierProbs === undefined
          ? {}
          : { modifierProbs: Object.freeze({ ...options.modifierProbs }) }),
        ...(options.input === undefined
          ? {}
          : {
              input: deepFreeze(copyJSON(options.input)) as Readonly<Record<string, unknown>>,
            }),
      })
      return Object.assign(() => mock(new Schema<Infer<typeof schema>>(node), frozen), {
        options: frozen,
        contracts: deepFreeze(contracts(node)),
      })
    },
  }
  return Object.freeze(runtime)
}
const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    Object.values(value).forEach(deepFreeze)
  }
  return value
}

/** Snapshot replay metadata while retaining executable callbacks in process. */
const snapshot = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value
  return Array.isArray(value)
    ? value.map(snapshot)
    : Object.fromEntries(Object.entries(record(value)).map(([key, item]) => [key, snapshot(item)]))
}
