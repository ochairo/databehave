/**
 * Composite schema builders: obj, arr, tuple, union, literal, enum_.
 *
 * These produce TS types derived from their inputs via mapped / conditional
 * types so that {@link Infer} yields the exact composite shape.
 */

import type {
  ArrayKind,
  EnumKind,
  LiteralKind,
  ObjectKind,
  SchemaNode,
  TupleKind,
  UnionKind,
} from '../foundation/ir.js'
import { withMods } from '../foundation/ir.js'
import { Discrete, Schema, type Infer } from '../foundation/types.js'

// ──────────────────────────────────────────────────────────────────────────
// object
// ──────────────────────────────────────────────────────────────────────────

type Fields = Record<string, Schema>

/** Field names that would clobber Object.prototype or pollute the prototype chain. */
const FORBIDDEN_FIELD_NAMES = new Set(['__proto__', 'prototype', 'constructor'])

const assertSafeFieldNames = (fields: Fields): void => {
  for (const k of Object.keys(fields)) {
    if (FORBIDDEN_FIELD_NAMES.has(k)) {
      throw new RangeError(
        `obj(): field name ${JSON.stringify(k)} is forbidden ` +
          `(would shadow Object.prototype; rename the field).`,
      )
    }
  }
}

/** Keys whose schema carries `optional: true` become optional in the output. */
type OptionalKeys<F extends Fields> = {
  [K in keyof F]: F[K]['_node']['mods'] extends { optional: true } ? K : never
}[keyof F]

type RequiredKeys<F extends Fields> = Exclude<keyof F, OptionalKeys<F>>

export type InferObject<F extends Fields> = {
  [K in RequiredKeys<F>]: Infer<F[K]>
} & {
  [K in OptionalKeys<F>]?: Infer<F[K]>
}

export class ObjectSchema<F extends Fields = Fields> extends Schema<
  // Distribute the mapped result through `unknown extends` to force evaluation.
  { [K in keyof InferObject<F>]: InferObject<F>[K] }
> {
  declare readonly _node: ObjectKind & { mods?: import('../foundation/ir.js').Modifiers }
  readonly _fields: F

  constructor(fields: F) {
    assertSafeFieldNames(fields)
    const irFields: Record<string, import('../foundation/ir.js').SchemaNode> = {}
    for (const k of Object.keys(fields)) {
      irFields[k] = (fields[k] as Schema)._node
    }
    super({ kind: 'object', fields: irFields })
    this._fields = fields
  }

  /**
   * Multi-field invariant — a predicate over the whole assembled object.
   *
   * Equivalent to `.invariant(...)` but typed against the object's inferred
   * shape, so cross-field rules (e.g. `start <= end`) get full type-checking.
   * The engine rejection-samples the object up to MAX_ATTEMPTS until the
   * predicate holds.
   */
  correlate(fn: (row: InferObject<F>) => boolean): this {
    return this.invariant((v) => fn(v as InferObject<F>))
  }
}

export const obj = <F extends Fields>(fields: F): ObjectSchema<F> => new ObjectSchema(fields)

// ──────────────────────────────────────────────────────────────────────────
// array
// ──────────────────────────────────────────────────────────────────────────

export class ArraySchema<S extends Schema> extends Schema<Infer<S>[]> {
  declare readonly _node: ArrayKind & { mods?: import('../foundation/ir.js').Modifiers }
  readonly _item: S

  constructor(item: S, opts: { length?: number; minLength?: number; maxLength?: number } = {}) {
    const base: ArrayKind = {
      kind: 'array',
      item: item._node,
      ...(opts.length !== undefined ? { length: opts.length } : {}),
      ...(opts.minLength !== undefined ? { minLength: opts.minLength } : {}),
      ...(opts.maxLength !== undefined ? { maxLength: opts.maxLength } : {}),
    }
    super(base)
    this._item = item
  }

  /**
   * Rebuild a fresh `ArraySchema` while preserving every previously-set
   * bound *and* every modifier (axes, occasionally, derivedFrom,
   * describe, weighted, …). Without this, `.min(2).max(10)` would
   * silently drop the `min` and `arr(int()).typically(1,5).min(2)`
   * would lose the distribution axis because the constructor builds
   * the IR node from scratch. Mods live in `_node.mods`, which is
   * outside the bounds-only constructor surface, so they have to be
   * grafted back on after construction via `withMods`.
   */
  private rebuild(patch: { length?: number; minLength?: number; maxLength?: number }): ArraySchema<S> {
    const node = this._node
    const next = new ArraySchema(this._item, {
      ...(node.length !== undefined ? { length: node.length } : {}),
      ...(node.minLength !== undefined ? { minLength: node.minLength } : {}),
      ...(node.maxLength !== undefined ? { maxLength: node.maxLength } : {}),
      ...patch,
    })
    if (node.mods) {
      // `_node` is declared `readonly` for the public API but we own
      // both ends of the assignment here — the just-built instance is
      // not observable to anyone else yet, so re-seating its IR node
      // is safe and avoids an extra clone.
      ;(next as { _node: SchemaNode })._node = withMods(next._node, node.mods)
    }
    return next
  }

  length(n: number): ArraySchema<S> {
    return this.rebuild({ length: n })
  }
  min(n: number): ArraySchema<S> {
    return this.rebuild({ minLength: n })
  }
  max(n: number): ArraySchema<S> {
    return this.rebuild({ maxLength: n })
  }
}

export const arr = <S extends Schema>(item: S): ArraySchema<S> => new ArraySchema(item)

// ──────────────────────────────────────────────────────────────────────────
// tuple
// ──────────────────────────────────────────────────────────────────────────

type InferTuple<T extends readonly Schema[]> = {
  [K in keyof T]: T[K] extends Schema ? Infer<T[K]> : never
}

export class TupleSchema<T extends readonly Schema[]> extends Schema<InferTuple<T>> {
  declare readonly _node: TupleKind & { mods?: import('../foundation/ir.js').Modifiers }
  readonly _items: T

  constructor(items: T) {
    super({ kind: 'tuple', items: items.map((s) => s._node) })
    this._items = items
  }
}

export const tuple = <T extends readonly Schema[]>(...items: T): TupleSchema<T> =>
  new TupleSchema(items)

// ──────────────────────────────────────────────────────────────────────────
// union
// ──────────────────────────────────────────────────────────────────────────

type InferUnion<T extends readonly Schema[]> = T[number] extends Schema
  ? Infer<T[number]>
  : never

export class UnionSchema<T extends readonly Schema[]> extends Schema<InferUnion<T>> {
  declare readonly _node: UnionKind & { mods?: import('../foundation/ir.js').Modifiers }
  readonly _options: T

  constructor(options: T) {
    if (options.length === 0) {
      throw new RangeError('union: requires at least one option')
    }
    super({ kind: 'union', options: options.map((s) => s._node) })
    this._options = options
  }
}

export const union = <T extends readonly Schema[]>(...options: T): UnionSchema<T> =>
  new UnionSchema(options)

// ──────────────────────────────────────────────────────────────────────────
// literal / enum
// ──────────────────────────────────────────────────────────────────────────

export class LiteralSchema<V extends string | number | boolean | null> extends Schema<V> {
  declare readonly _node: LiteralKind & { mods?: import('../foundation/ir.js').Modifiers }
  declare readonly [Discrete]: true
}

export const literal = <V extends string | number | boolean | null>(value: V): LiteralSchema<V> =>
  new LiteralSchema({ kind: 'literal', value })

export class EnumSchema<V extends string | number> extends Schema<V> {
  declare readonly _node: EnumKind & { mods?: import('../foundation/ir.js').Modifiers }
  declare readonly [Discrete]: true
  readonly _values: readonly V[]

  constructor(values: readonly V[]) {
    if (values.length === 0) {
      throw new RangeError('enum: requires at least one value')
    }
    super({ kind: 'enum', values })
    this._values = values
  }
}

export const enum_ = <V extends string | number>(values: readonly V[]): EnumSchema<V> =>
  new EnumSchema(values)
