/**
 * Phantom-typed schema builder + Infer<>.
 *
 * Every builder carries:
 *   - `_node`: serializable IR (runtime)
 *   - `_type`: phantom TS type parameter for inference (compile-time only)
 *
 * Modifiers (.nullable / .optional / .default / .describe) return a *new*
 * builder with updated phantom type and updated IR.
 */

import type { Axes, DerivedFn, Distribution, DomainConstraint, EventuallyOverride, InvariantFn, OccasionalOverride } from './axes.js'
import type { Modifiers, SchemaNode } from './ir.js'
import { withMods } from './ir.js'

/** Base builder. Subclasses (StringSchema, NumberSchema, …) extend this. */
export class Schema<out T = unknown> {
  declare readonly _type: T
  readonly _node: SchemaNode

  constructor(node: SchemaNode) {
    this._node = node
  }

  nullable(): Schema<T | null> {
    return new Schema<T | null>(withMods(this._node, { nullable: true }))
  }

  optional(): Schema<T | undefined> {
    return new Schema<T | undefined>(withMods(this._node, { optional: true }))
  }

  default(value: T): Schema<T> {
    return new Schema<T>(withMods(this._node, { hasDefault: true, defaultValue: value }))
  }

  describe(text: string): this {
    return this.withModsPreserveType({ description: text })
  }

  // ── data-schema axes ──────────────────────────────────────────────────────

  /** Weighted distribution over discrete values. Weights are relative. */
  weighted(weights: ReadonlyArray<readonly [T & (string | number | boolean), number]>): this {
    return this.withAxes({
      distribution: {
        kind: 'weighted',
        weights: weights as ReadonlyArray<readonly [string | number | boolean, number]>,
      },
    })
  }

  /** Normal (Gaussian) distribution for numeric schemas. */
  normal(mean: number, stddev: number): this {
    return this.withAxes({ distribution: { kind: 'normal', mean, stddev } })
  }

  /** Typical range — values concentrate uniformly inside [from, to]. */
  typically(from: number, to: number): this {
    return this.withAxes({ distribution: { kind: 'typical', from, to } })
  }

  /** Force `value` with probability `p` (stacks before base distribution). */
  occasionally(value: T, p: number): this {
    if (!(p >= 0 && p <= 1)) throw new RangeError(`occasionally: p must be in [0,1], got ${p}`)
    const override: OccasionalOverride = { value, p }
    return this.withAxes({ occasionally: [override] })
  }

  /**
   * Force `value` every `every` rows (deterministic, driven by `ctx.index`).
   *
   * Useful for periodic rare events that must hit at a guaranteed cadence
   * (e.g. a recurring reset every N rows). Skipped when `ctx.index` is undefined.
   */
  eventually(every: number, value: T, opts?: { readonly offset?: number }): this {
    if (!Number.isInteger(every) || every < 1) {
      throw new RangeError(`eventually: every must be a positive integer, got ${every}`)
    }
    const override: EventuallyOverride = {
      value,
      every,
      ...(opts?.offset !== undefined ? { offset: opts.offset } : {}),
    }
    return this.withAxes({ eventually: [override] })
  }

  /** Field is computed from sibling/root context — generator skips sampling. */
  derivedFrom(fn: DerivedFn): this {
    return this.withAxes({ derived: fn })
  }

  /** Single-record predicate. Generator retries up to MAX_ATTEMPTS to satisfy. */
  invariant(fn: InvariantFn): this {
    return this.withAxes({ invariants: [fn] })
  }

  /** Restrict to a closed candidate set or a lookup-by-sibling-field map. */
  in(constraint: DomainConstraint | readonly unknown[]): this {
    const dom: DomainConstraint = Array.isArray(constraint)
      ? { kind: 'values', values: constraint }
      : (constraint as DomainConstraint)
    return this.withAxes({ domain: dom })
  }

  // ── internal helpers ──────────────────────────────────────────────────────
  /**
   * Re-apply a complete `Axes` record to this schema. Public so that
   * IR-reconstruction helpers (e.g. `fromIR`) can replay axes without
   * reaching through a protected method via casts. Prefer the fluent axis
   * builders (`.weighted`, `.in`, `.derivedFrom`, ...) in user code.
   */
  _applyAxes(axes: Axes): this {
    return this.withModsPreserveType({ axes })
  }
  protected withAxes(axes: Axes): this {
    return this.withModsPreserveType({ axes })
  }

  protected withModsPreserveType(patch: Partial<Modifiers>): this {
    const next = Object.create(Object.getPrototypeOf(this) as object) as this
    Object.assign(next, this, {
      _node: withMods(this._node, patch),
    } satisfies { _node: SchemaNode })
    return next
  }
}

/**
 * Infer the TypeScript type a schema generates / accepts.
 *
 * ```ts
 * const User = obj({ id: int(), name: str() })
 * type User = Infer<typeof User>  // { id: number; name: string }
 * ```
 */
export type Infer<S> = S extends Schema<infer T> ? T : never

/** Re-export modifier shape for advanced consumers. */
export type { Distribution, DomainConstraint, Modifiers, SchemaNode }
