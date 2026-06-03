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
import { SchemaConflictError } from './errors.js'
import type { Modifiers, SchemaNode } from './ir.js'
import { withMods } from './ir.js'

/**
 * Module-private capability marker symbol keys.
 *
 * Schemas opt into a capability by `declare`ing the corresponding bracketed
 * property as the literal `true`. Methods like `.weighted` / `.normal` /
 * `.typically` then gate themselves with a `this:` constraint that requires
 * the marker. Symbols (rather than string keys like `_capDiscrete`) keep the
 * markers out of consumer IntelliSense and out of any `Object.keys` loop.
 *
 * Three caps are required to mirror the runtime allow-list cleanly:
 *
 *   - `Discrete`   — values are enumerable; `.weighted` is meaningful.
 *                    Carried by `str / int / bool / literal / enum`.
 *   - `Numeric`    — values are bounded numerics; `.typically(from, to)` is
 *                    meaningful (the generator clamps and, for integers,
 *                    rounds). Carried by `num / int / decimal`.
 *   - `Continuous` — values are real-valued; `.normal(mean, σ)` is
 *                    meaningful (Gaussian on integers would silently lose
 *                    σ to rounding, so int is excluded). Carried by
 *                    `num / decimal`.
 *
 * The symbols are real runtime values so subclass files can `import` them
 * to redeclare the marker. They are NOT re-exported from the package root
 * or from `@databehave/schema/internal`; the package's `exports` field
 * limits deep-path imports to those two entries.
 */
export const Discrete: unique symbol = Symbol('databehave.cap.discrete')
export const Numeric: unique symbol = Symbol('databehave.cap.numeric')
export const Continuous: unique symbol = Symbol('databehave.cap.continuous')

/**
 * Allow-list for which IR kinds may legally carry each axis distribution.
 *
 * Mirrors the type-system `this:` gating on `.weighted` / `.normal` /
 * `.typically`. Used by the runtime guard in those methods to fail-loud
 * when a caller bypasses TypeScript (`as any`, plain JS, `// @ts-ignore`).
 *
 * Stays in sync with `docs/stability.md` "capability matrix".
 */
const CAP_BY_OP: {
  readonly weighted: ReadonlySet<SchemaNode['kind']>
  readonly normal: ReadonlySet<SchemaNode['kind']>
  readonly typically: ReadonlySet<SchemaNode['kind']>
} = {
  // .weighted: discrete-valued kinds. For `kind:'number'` it is allowed only
  // when `int === true` (further check below).
  weighted: new Set<SchemaNode['kind']>(['number', 'string', 'literal', 'enum', 'boolean']),
  // .normal: continuous-numeric kinds. For `kind:'number'` it is allowed
  // only when `int === false` (further check below).
  normal: new Set<SchemaNode['kind']>(['number', 'decimal']),
  // .typically: any numeric kind (int or float or decimal — for ints the
  // generator clamps and rounds).
  typically: new Set<SchemaNode['kind']>(['number', 'decimal']),
}

const checkAxisAllowed = (
  op: 'weighted' | 'normal' | 'typically',
  node: SchemaNode,
): void => {
  if (!CAP_BY_OP[op].has(node.kind)) {
    throw new SchemaConflictError(
      `.${op}() is not applicable to schema kind '${node.kind}'`,
      [],
      `see docs/stability.md (capability matrix)`,
    )
  }
  // Number-kind is split between `int()` (discrete) and `num()` (continuous).
  if (node.kind === 'number') {
    const isInt = node.int === true
    if (op === 'weighted' && !isInt) {
      throw new SchemaConflictError(
        `.weighted() is not applicable to num() (continuous); use int().weighted([...]) for discrete numeric weighting`,
        [],
        `see docs/stability.md (capability matrix)`,
      )
    }
    if (op === 'normal' && isInt) {
      throw new SchemaConflictError(
        `.normal() is not applicable to int() (discrete); use num().normal(...) for a continuous Gaussian`,
        [],
        `see docs/stability.md (capability matrix)`,
      )
    }
  }
}

/** Base builder. Subclasses (StringSchema, NumberSchema, …) extend this. */
export class Schema<T = unknown> {
  declare readonly _type: T
  readonly _node: SchemaNode

  // Phantom capability markers — type-only, never written or read at runtime.
  // The base class declares them as required `boolean`; subclasses (and a
  // few builder factories) opt in by `declare`ing them as the literal `true`.
  // Combined with the `this:` parameter on `.weighted` / `.normal` /
  // `.typically` below, they make those methods structurally unavailable on
  // schemas where the axis does not apply (`obj({})`, `arr(str())`,
  // `union(...)`, plain `num()` for `.weighted`, plain `int()` for
  // `.normal`, …) — calls become a TS error rather than a silent no-op.
  // Subclasses remain assignable to the base because `true extends boolean`.
  //
  // Why required (`boolean`) and not optional (`boolean | undefined`)?
  // With `exactOptionalPropertyTypes: true`, an optional marker on the
  // base lets a base-typed reference (`const b: Schema<boolean> = bool()`)
  // silently satisfy `this & { [Discrete]: true }` because TS treats the
  // missing-property branch as compatible. Declaring as required `boolean`
  // forces TS to compare `boolean extends true` (false) and reject the
  // call — closes the cap-via-cast gap that motivated F2.
  declare readonly [Discrete]: boolean
  declare readonly [Numeric]: boolean
  declare readonly [Continuous]: boolean

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
  weighted(
    this: this & { readonly [Discrete]: true },
    weights: ReadonlyArray<readonly [T & (string | number | boolean), number]>,
  ): this {
    checkAxisAllowed('weighted', this._node)
    return this.withAxes({
      distribution: {
        kind: 'weighted',
        weights: weights as ReadonlyArray<readonly [string | number | boolean, number]>,
      },
    })
  }

  /** Normal (Gaussian) distribution for numeric schemas. */
  normal(this: this & { readonly [Continuous]: true }, mean: number, stddev: number): this {
    checkAxisAllowed('normal', this._node)
    return this.withAxes({ distribution: { kind: 'normal', mean, stddev } })
  }

  /** Typical range — values concentrate uniformly inside [from, to]. */
  typically(this: this & { readonly [Numeric]: true }, from: number, to: number): this {
    checkAxisAllowed('typically', this._node)
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

  /**
   * Field is computed from sibling/root context — generator skips sampling.
   *
   * The generic `U extends T` ensures the function's return type is
   * assignable to the schema's value type. Combined with `relate(rows, field)`
   * (which propagates `R[K]` through `DerivedFn<R[K]>`), this catches
   * FK-type mismatches at compile time
   * (e.g. `int().derivedFrom(relate(rowsWithStringSku, 'sku'))`).
   */
  derivedFrom<U extends T>(fn: DerivedFn<U>): this {
    return this.withAxes({ derived: fn as DerivedFn })
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
   *
   * Note: this is a low-level escape hatch — it does NOT run the
   * capability allow-list that `.weighted` / `.normal` / `.typically`
   * apply. Callers that round-trip IR are trusted to keep the IR coherent.
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
