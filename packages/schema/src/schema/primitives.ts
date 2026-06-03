/**
 * Primitive schema builders: str, num, int, bool, null_.
 *
 * Each returns a {@link Schema} instance whose phantom `_type` reflects the
 * generated TypeScript type, and whose `_node` is the serializable IR.
 */

import type { Modifiers, NumberKind, StringKind } from '../foundation/ir.js'
import { Continuous, Discrete, Numeric, Schema } from '../foundation/types.js'

// ──────────────────────────────────────────────────────────────────────────
// string
// ──────────────────────────────────────────────────────────────────────────

export class StringSchema extends Schema<string> {
  declare readonly _node: StringKind & { mods?: Modifiers }
  declare readonly [Discrete]: true

  min(n: number): StringSchema {
    return new StringSchema({ ...this._node, min: n })
  }
  max(n: number): StringSchema {
    return new StringSchema({ ...this._node, max: n })
  }
  pattern(re: RegExp | string): StringSchema {
    return new StringSchema({
      ...this._node,
      pattern: typeof re === 'string' ? re : re.source,
    })
  }
}

export const str = (): StringSchema =>
  new StringSchema({ kind: 'string', format: 'plain' })

// ──────────────────────────────────────────────────────────────────────────
// number / int
//
// `NumberSchema` is the base class for both float-shaped (`num()`) and
// integer-shaped (`int()`) numeric schemas — the IR-level distinction is
// `_node.int`, this hierarchy is just a type-system reflection of it.
//
// Capability markers are NOT declared on the `NumberSchema` class because
// they need to differ between the two factories without violating subclass
// override constraints:
//   - `num()` returns `NumberSchema & { [Numeric]: true; [Continuous]: true }`
//     — gets `.normal` / `.typically`, but NOT `.weighted` (continuous
//     values can't be enumerated).
//   - `int()` returns `IntSchema & { [Numeric]: true }` (with `[Discrete]`
//     declared on the class) — gets `.weighted` and `.typically` (the
//     latter clamps and rounds), but NOT `.normal` (Gaussian on integers
//     would silently lose σ to rounding).
//   - `decimal()` (in `./decimal.ts`) carries `[Numeric]` AND `[Continuous]`
//     by class declaration, mirroring `num()`.
//
// `min` / `max` use `this`-typed returns (rather than the explicit class
// type) so the marker intersection is preserved through chains:
//   `num().min(0).normal(0, 1)`            ✓
//   `int().min(1).max(5).weighted([...])`  ✓
// ──────────────────────────────────────────────────────────────────────────

export class NumberSchema extends Schema<number> {
  declare readonly _node: NumberKind & { mods?: Modifiers }

  min(n: number): this {
    return this.cloneWithNode({ ...this._node, min: n })
  }
  max(n: number): this {
    return this.cloneWithNode({ ...this._node, max: n })
  }

  protected cloneWithNode(node: NumberKind & { mods?: Modifiers }): this {
    const next = Object.create(Object.getPrototypeOf(this) as object) as this
    Object.assign(next, this, { _node: node })
    return next
  }
}

/** `int()`-flavoured number — discrete, no Gaussian. Extends `NumberSchema`. */
export class IntSchema extends NumberSchema {
  declare readonly [Discrete]: true
}

export const num = (): NumberSchema & {
  readonly [Numeric]: true
  readonly [Continuous]: true
} =>
  new NumberSchema({ kind: 'number', int: false }) as NumberSchema & {
    readonly [Numeric]: true
    readonly [Continuous]: true
  }

export const int = (): IntSchema & { readonly [Numeric]: true } =>
  new IntSchema({ kind: 'number', int: true }) as IntSchema & {
    readonly [Numeric]: true
  }

// ──────────────────────────────────────────────────────────────────────────
// boolean / null
// ──────────────────────────────────────────────────────────────────────────

export class BooleanSchema extends Schema<boolean> {
  declare readonly [Discrete]: true
}

export class NullSchema extends Schema<null> {}

export const bool = (): BooleanSchema => new BooleanSchema({ kind: 'boolean' })

export const null_ = (): NullSchema => new NullSchema({ kind: 'null' })
