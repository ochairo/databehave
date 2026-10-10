import { standardBehaviors } from '../standard/behaviors.js'
/**
 * Data-schema axes.
 *
 * Each axis is optional metadata attached to a schema node via `Modifiers.axes`.
 * The generator inspects axes during sampling; the validator inspects only
 * `domain` (since distribution is a sampling hint, not a conformance constraint).
 *
 * Generation order: modifiers; derived; eventually; occasionally; bounded
 * invariants around domain/distribution/kind sampling. Short-circuit values
 * bypass invariants. Dataset identity is handled by the dataset policy.
 */

/** A generation context exposed to derived functions and invariants. */
export type GenContext = {
  /** Root value being built, accessible by JSON-pointer-like path. */
  readonly root: unknown
  /** Sibling object for the current field (the immediate parent object's data). */
  readonly parent: Readonly<Record<string, unknown>>
  /** Nearest enclosing array index. `undefined` when no array is in scope. */
  readonly index?: number
  /** Caller-supplied context channel (free-form key/value, never sampled). */
  readonly input?: Readonly<Record<string, unknown>>
  /** Stable seed string for this node (derived from path + identity). */
  readonly seed: string
}

/** A single-record predicate. Returns true if the value is acceptable. */
export type InvariantFn = (value: unknown, ctx: GenContext) => boolean

/**
 * A pure function computing a field's value from sibling/root data.
 *
 * The generic parameter is the produced value type. It defaults to
 * `unknown` so call sites that do not annotate (most plugin code) keep
 * working unchanged. Builders such as `relate(rows, field)` propagate
 * the inferred field type through this parameter so that
 * `int().derivedFrom(relate(stringRows, 'sku'))` becomes a TS error
 * (`string` is not assignable to `number`).
 */
export type DerivedFn<T = unknown> = (ctx: GenContext) => T

/** A weighted distribution over discrete enum values. */
export type WeightedDistribution = {
  readonly kind: 'weighted'
  /** Map of value → weight (relative; need not sum to 1). */
  readonly weights: ReadonlyArray<readonly [string | number | boolean, number]>
}

/** A normal (Gaussian) distribution for numbers. */
export type NormalDistribution = {
  readonly kind: 'normal'
  readonly mean: number
  readonly stddev: number
}

/** A typical-range distribution (uniform within [from, to], reachable subset of [min, max]). */
export type TypicalDistribution = {
  readonly kind: 'typical'
  readonly from: number
  readonly to: number
}

/**
 * An "occasionally" override: with probability `p`, the produced value is
 * forced to `value`. Stacks before the base distribution.
 */
export type OccasionalOverride = {
  readonly value: unknown
  readonly p: number
}

/**
 * An "eventually" override: every `every` rows the produced value is
 * forced to `value`, deterministically driven by `ctx.index`.
 *
 * Stacks before `occasionally`. Skipped when `ctx.index` is undefined.
 */
export type EventuallyOverride = {
  readonly value: unknown
  readonly every: number
  readonly offset?: number
}

export type Distribution = WeightedDistribution | NormalDistribution | TypicalDistribution

/** A closed candidate set the value must belong to (`D` in the formal model). */
export type DomainConstraint =
  | { readonly kind: 'values'; readonly values: readonly unknown[] }
  | { readonly kind: 'lookup'; readonly fromField: string; readonly map: Readonly<Record<string, readonly unknown[]>> }

/** All axis metadata attached to a schema node. */
export type Axes = {
  readonly distribution?: Distribution
  readonly occasionally?: readonly OccasionalOverride[]
  readonly eventually?: readonly EventuallyOverride[]
  readonly derived?: DerivedFn
  readonly invariants?: readonly InvariantFn[]
  readonly domain?: DomainConstraint
}

/** Merge standard axes through their owning behavior descriptors. */
export const mergeAxes = (a: Axes | undefined, b: Axes): Axes => {
  if (a === undefined) return b
  let node: import('./ir.js').SchemaNode = { kind: 'metadata', mods: { axes: a ?? {} } }
  for (const [id, incoming] of Object.entries(b)) {
    const descriptor = standardBehaviors.find((behavior) => behavior.id === id)
    if (descriptor === undefined) throw new TypeError(`missing schema behavior ${id}`)
    const previous = descriptor.read(node)
    node = descriptor.write(node, previous === undefined ? incoming : descriptor.merge(previous, incoming))
  }
  return node.mods?.axes ?? {}
}
