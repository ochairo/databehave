/**
 * Data-schema axes.
 *
 * Each axis is optional metadata attached to a schema node via `Modifiers.axes`.
 * The generator inspects axes during sampling; the validator inspects only
 * `domain` (since distribution is a sampling hint, not a conformance constraint).
 *
 * Priority order during generation (high → low):
 *   1. invariants (single-record predicates that must hold)
 *   2. identity   (dataset-level — handled by dataset engine)
 *   3. derived    (computed from other fields → fixed)
 *   4. conditional shape (handled by union/discriminated)
 *   5. domain     (closed candidate set)
 *   6. distribution (weighting within domain ∩ type)
 *   7. type defaults
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

/** Merge two axis records (right-hand wins for scalar fields, lists concat). */
export const mergeAxes = (a: Axes | undefined, b: Axes): Axes => {
  if (a === undefined) return b
  const merged: {
    distribution?: Distribution
    occasionally?: readonly OccasionalOverride[]
    eventually?: readonly EventuallyOverride[]
    derived?: DerivedFn
    invariants?: readonly InvariantFn[]
    domain?: DomainConstraint
  } = {}
  const dist = b.distribution ?? a.distribution
  if (dist !== undefined) merged.distribution = dist
  const der = b.derived ?? a.derived
  if (der !== undefined) merged.derived = der
  const dom = b.domain ?? a.domain
  if (dom !== undefined) merged.domain = dom
  const occ = [...(a.occasionally ?? []), ...(b.occasionally ?? [])]
  if (occ.length > 0) merged.occasionally = occ
  const evn = [...(a.eventually ?? []), ...(b.eventually ?? [])]
  if (evn.length > 0) merged.eventually = evn
  const inv = [...(a.invariants ?? []), ...(b.invariants ?? [])]
  if (inv.length > 0) merged.invariants = inv
  return merged
}
