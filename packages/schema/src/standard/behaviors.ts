import type {
  Axes,
  DerivedFn,
  DomainConstraint,
  Distribution,
  EventuallyOverride,
  InvariantFn,
  OccasionalOverride,
} from '../foundation/axes.js'
import { SchemaConflictError } from '../foundation/errors.js'
import type { Modifiers, SchemaNode, StandardSchemaNode } from '../foundation/ir.js'
import type {
  BehaviorDescriptor,
  BehaviorPhase,
  GenerationContext,
  ValidationContext,
} from '../runtime/contracts.js'
import { genDecimal, genNumber, sampleDiscrete, domainCandidates, pickWeighted } from './generation.js'
import { record } from './kinds.js'

const passthrough = (_m: unknown, _n: SchemaNode, _c: GenerationContext, next: () => unknown): unknown =>
  next()
const accept = (
  _m: unknown,
  _n: SchemaNode,
  _v: unknown,
  _c: ValidationContext,
  next: () => unknown,
): unknown => next()
const replace = (_previous: unknown, next: unknown): unknown => next
const concat = (previous: unknown, next: unknown): unknown => [...list(previous), ...list(next)]
const list = (value: unknown): readonly unknown[] => {
  if (!Array.isArray(value)) throw new TypeError('expected behavior list')
  return value
}
const probability = (value: unknown): void => {
  if (typeof value !== 'number' || !(value >= 0 && value <= 1))
    throw new TypeError('expected probability in [0,1]')
}
const finite = (value: unknown): void => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('expected finite number')
}
/** Preserve JSON data and reject every closure, cycle and lossy JSON value. */
export const jsonData = (
  value: unknown,
  path: readonly (string | number)[] = [],
  seen = new Set<object>(),
): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'object')
    throw new SchemaConflictError(
      `serializeSchema: closure or non-JSON value at ${path
        .map((part) => (typeof part === 'number' ? `[${part}]` : `.${part}`))
        .join('')
        .replace(/^\./, '')}`,
      path,
      undefined,
      'serialize.closure-axis',
    )
  if (seen.has(value)) throw new TypeError('serializeSchema: cyclic metadata')
  seen.add(value)
  let out: unknown
  if (Array.isArray(value)) out = value.map((item, i) => jsonData(item, [...path, i], seen))
  else
    out = Object.fromEntries(
      Object.entries(record(value)).map(([key, item]) => [key, jsonData(item, [...path, key], seen)]),
    )
  seen.delete(value)
  return out
}
/** Build a standard axis descriptor with its own parser and policy. */
const axis = <K extends keyof Axes>(
  id: K,
  phase: BehaviorPhase,
  check: (value: unknown) => Axes[K],
  generate: BehaviorDescriptor['generate'] = passthrough,
  validate: BehaviorDescriptor['validate'] = accept,
  merge: BehaviorDescriptor['merge'] = replace,
  appliesTo: BehaviorDescriptor['appliesTo'] = () => true,
): BehaviorDescriptor =>
  Object.freeze({
    id,
    version: 1,
    phase,
    read: (node) => node.mods?.axes?.[id],
    write: (node, value) => ({
      ...node,
      mods: { ...node.mods, axes: { ...node.mods?.axes, [id]: check(value) } },
    }),
    checkMetadata: check,
    appliesTo,
    merge,
    generate,
    validate,
    serialize: (value) => jsonData(value, ['axes', id]),
  } satisfies BehaviorDescriptor)
const modifiers: BehaviorDescriptor = Object.freeze({
  id: 'modifiers',
  version: 1,
  phase: 'modifier',
  read: (node) => {
    if (node.mods === undefined) return {}
    const { axes: _axes, behaviors: _behaviors, ...mods } = node.mods
    return mods
  },
  write: (node, value) =>
    Object.keys(record(value)).length === 0 ? node : { ...node, mods: { ...node.mods, ...record(value) } },
  checkMetadata: (value) => {
    const mods = record(value)
    for (const key of ['nullable', 'optional', 'hasDefault'])
      if (mods[key] !== undefined && typeof mods[key] !== 'boolean')
        throw new TypeError(`invalid modifier ${key}`)
    if (mods.description !== undefined && typeof mods.description !== 'string')
      throw new TypeError('invalid description')
    for (const key of Object.keys(mods))
      if (!['nullable', 'optional', 'hasDefault', 'defaultValue', 'description'].includes(key))
        throw new TypeError(`unknown modifier ${key}`)
    return mods
  },
  appliesTo: () => true,
  merge: (a, b) => ({ ...record(a), ...record(b) }),
  generate: (value, _node, ctx, next) => {
    const mods = value as Modifiers
    const probs = ctx.modifierProbs
    if (mods.hasDefault === true && probs.default > 0 && ctx.rng.next() < probs.default) {
      ctx.emit({ path: ctx.path, axis: 'default' })
      return mods.defaultValue
    }
    if (mods.optional === true && probs.optional > 0 && ctx.rng.next() < probs.optional) {
      ctx.emit({ path: ctx.path, axis: 'optional-skip' })
      return undefined
    }
    if (mods.nullable === true && probs.nullable > 0 && ctx.rng.next() < probs.nullable) {
      ctx.emit({ path: ctx.path, axis: 'nullable-null' })
      return null
    }
    return next()
  },
  validate: (value, _node, input, _ctx, next) => {
    const mods = value as Modifiers
    if (input === undefined && mods.optional === true) return undefined
    if (input === undefined && mods.hasDefault === true) return mods.defaultValue
    if (input === null && mods.nullable === true) return null
    return next()
  },
  serialize: (value) => jsonData(value, ['mods']),
} satisfies BehaviorDescriptor)
const derived = axis(
  'derived',
  'derived',
  (value) => {
    if (typeof value !== 'function') throw new TypeError('derived must be a function')
    return value as DerivedFn
  },
  (value, _node, ctx) => {
    ctx.emit({ path: ctx.path, axis: 'derived' })
    return (value as DerivedFn)(ctx)
  },
  (value, _node, input, ctx, next) => {
    let expected: unknown
    try {
      expected = (value as DerivedFn)({ ...ctx, root: ctx.root ?? input })
    } catch (error) {
      ctx.issues.push({
        path: ctx.path,
        code: 'derived.callback-threw',
        message: `derived callback threw: ${error instanceof Error ? error.message : String(error)}`,
        received: input,
      })
      return input
    }
    if (!deepEqual(expected, input))
      ctx.issues.push({
        path: ctx.path,
        code: 'derived.mismatch',
        message: 'derived value does not match computed value',
        expected: safeStringify(expected),
        received: input,
      })
    return next()
  },
)
const eventually = axis(
  'eventually',
  'cadence',
  (value) => {
    for (const item of list(value)) {
      const o = record(item)
      if (!Number.isInteger(o.every) || Number(o.every) < 1)
        throw new TypeError('eventually requires positive integer cadence')
      if (o.offset !== undefined) finite(o.offset)
    }
    return value as readonly EventuallyOverride[]
  },
  (value, _node, ctx, next) => {
    for (const o of value as readonly EventuallyOverride[]) {
      const offset = o.offset ?? 0
      if (
        ctx.index !== undefined &&
        ctx.index >= offset &&
        (((ctx.index - offset) % o.every) + o.every) % o.every === 0
      ) {
        ctx.emit({ path: ctx.path, axis: 'eventually' })
        return o.value
      }
    }
    return next()
  },
  accept,
  concat,
)
const occasionally = axis(
  'occasionally',
  'cadence',
  (value) => {
    for (const item of list(value)) probability(record(item).p)
    return value as readonly OccasionalOverride[]
  },
  (value, _node, ctx, next) => {
    for (const o of value as readonly OccasionalOverride[])
      if (ctx.rng.next() < o.p) {
        ctx.emit({ path: ctx.path, axis: 'occasionally' })
        return o.value
      }
    return next()
  },
  accept,
  concat,
)
const invariants = axis(
  'invariants',
  'invariant',
  (value) => {
    if (list(value).some((item) => typeof item !== 'function'))
      throw new TypeError('invariants require functions')
    return value as readonly InvariantFn[]
  },
  (value, _node, ctx, next) => {
    const predicates = value as readonly InvariantFn[]
    if (predicates.length === 0) return next()
    for (let i = 0; i < 100; i++) {
      const out = next()
      if (predicates.every((fn) => fn(out, ctx))) {
        ctx.emit({ path: ctx.path, axis: 'invariant-pass', attempts: i + 1 })
        return out
      }
    }
    ctx.emit({ path: ctx.path, axis: 'invariant-fail', attempts: 100 })
    throw new SchemaConflictError(
      'invariant unsatisfied after 100 attempts',
      ctx.path,
      'relax the invariant or narrow the distribution / domain',
    )
  },
  (value, _node, _input, ctx, next) => {
    const out = next()
    for (const [i, fn] of (value as readonly InvariantFn[]).entries()) {
      try {
        if (!fn(out, { ...ctx, root: ctx.root ?? out }))
          ctx.issues.push({
            path: ctx.path,
            code: 'invariant.failed',
            message: `invariant[${i}] failed`,
            received: out,
          })
      } catch (error) {
        ctx.issues.push({
          path: ctx.path,
          code: 'invariant.callback-threw',
          message: `invariant[${i}] threw: ${error instanceof Error ? error.message : String(error)}`,
          received: out,
        })
      }
    }
    return out
  },
  concat,
)
const domain = axis(
  'domain',
  'sample',
  (value) => {
    const d = record(value)
    if (d.kind === 'values') list(d.values)
    else if (d.kind === 'lookup') {
      if (typeof d.fromField !== 'string') throw new TypeError('invalid lookup field')
      Object.values(record(d.map)).forEach(list)
    } else throw new TypeError('unknown domain kind')
    return value as DomainConstraint
  },
  (value, _node, ctx, next) => {
    const candidates = domainCandidates(value as DomainConstraint, ctx.parent)
    const rng = ctx.leafRng()
    const result = candidates.length === 0 ? next() : next({
      candidates,
      fallback: () => rng.pick(candidates),
    })
    ctx.emit({ path: ctx.path, axis: 'domain' })
    return result
  },
  (value, _node, input, ctx, next) => {
    const d = value as DomainConstraint
    if (d.kind === 'values' && !d.values.includes(input))
      ctx.issues.push({
        path: ctx.path,
        code: 'domain.not-in-values',
        message: 'value not in domain',
        received: input,
      })
    if (d.kind === 'lookup') {
      const key = ctx.parent[d.fromField]
      const candidates = typeof key === 'string' ? d.map[key] : undefined
      if (candidates !== undefined && !candidates.includes(input))
        ctx.issues.push({
          path: ctx.path,
          code: 'domain.lookup-mismatch',
          message: 'value not in lookup domain',
          received: input,
        })
    }
    return next()
  },
)
const distribution = axis(
  'distribution',
  'sample',
  (value) => {
    const d = record(value)
    if (d.kind === 'weighted')
      for (const entry of list(d.weights)) {
        const pair = list(entry)
        if (pair.length !== 2 || !['number', 'string', 'boolean'].includes(typeof pair[0]))
          throw new TypeError('invalid weight')
        finite(pair[1])
        if (Number(pair[1]) < 0) throw new TypeError('negative weight')
      }
    else if (d.kind === 'normal') {
      finite(d.mean)
      finite(d.stddev)
      if (Number(d.stddev) < 0) throw new TypeError('negative standard deviation')
    } else if (d.kind === 'typical') {
      finite(d.from)
      finite(d.to)
    } else throw new TypeError('unknown distribution')
    return value as Distribution
  },
  (value, node, ctx, next) => {
    const dist = value as Distribution
    ctx.emit({ path: ctx.path, axis: 'distribution' })
    if (ctx.sampling !== undefined) {
      if (dist.kind === 'weighted') {
        const weights = dist.weights.filter(([value]) => ctx.sampling?.candidates.includes(value))
        const picked = pickWeighted(weights, ctx.leafRng())
        if (picked !== undefined) return picked
      }
      return next()
    }
    if (node.kind === 'number')
      return genNumber(node as Extract<StandardSchemaNode, { kind: 'number' }>, dist, ctx.leafRng(), ctx.path)
    if (node.kind === 'decimal')
      return genDecimal(
        node as Extract<StandardSchemaNode, { kind: 'decimal' }>,
        dist,
        ctx.leafRng(),
        ctx.path,
      )
    if (node.kind === 'enum')
      return sampleDiscrete(
        (node as Extract<StandardSchemaNode, { kind: 'enum' }>).values,
        dist,
        ctx.leafRng(),
      )
    if (node.kind === 'discriminated' && dist.kind === 'weighted') {
      const branches = (node as Extract<StandardSchemaNode, { kind: 'discriminated' }>).branches
      const tags = Object.keys(branches)
      const filtered = dist.weights.filter(([v]) => tags.includes(String(v)))
      const picked = filtered.length > 0 ? pickWeighted(filtered, ctx.rng) : undefined
      const tag = picked === undefined ? ctx.rng.pick(tags) : String(picked)
      const branch = branches[tag]
      if (branch === undefined) throw new TypeError('unknown discriminator branch')
      return ctx.generate(branch, ctx.path, ctx.parent)
    }
    const result = next()
    ctx.emit({ path: ctx.path, axis: 'distribution' })
    return result
  },
  accept,
  replace,
  (node, value) => {
    const dist = value as Distribution
    if (dist.kind === 'normal')
      return node.kind === 'decimal' || (node.kind === 'number' && node.int === false)
    if (dist.kind === 'typical') return node.kind === 'decimal' || node.kind === 'number'
    return (
      ['string', 'literal', 'enum', 'boolean', 'discriminated'].includes(node.kind) ||
      (node.kind === 'number' && node.int === true)
    )
  },
)
/** Standard behavior descriptors; order preserves eventually before occasionally. */
export const standardBehaviors: readonly BehaviorDescriptor[] = Object.freeze([
  modifiers,
  derived,
  eventually,
  occasionally,
  invariants,
  domain,
  distribution,
])
const deepEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true
  if (
    a === null ||
    b === null ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false
  const aa = a as Record<string, unknown>
  const bb = b as Record<string, unknown>
  return (
    Object.keys(aa).length === Object.keys(bb).length &&
    Object.keys(aa).every((key) => Object.hasOwn(bb, key) && deepEqual(aa[key], bb[key]))
  )
}

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}
