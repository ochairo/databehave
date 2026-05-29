/**
 * Primitive schema builders: str, num, int, bool, null_.
 *
 * Each returns a {@link Schema} instance whose phantom `_type` reflects the
 * generated TypeScript type, and whose `_node` is the serializable IR.
 */

import type { NumberKind, StringKind } from '../foundation/ir.js'
import { SchemaConflictError } from '../foundation/errors.js'
import { Schema } from '../foundation/types.js'

// ──────────────────────────────────────────────────────────────────────────
// string
// ──────────────────────────────────────────────────────────────────────────

export class StringSchema extends Schema<string> {
  declare readonly _node: StringKind & { mods?: import('../foundation/ir.js').Modifiers }

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

  // ── capability matrix — see docs/STABILITY.md ──────────────────────────
  // Strings are discrete (`.weighted` inherited from base is meaningful)
  // but not numeric — Gaussian / range distributions are nonsensical.
  /** @deprecated `.normal(...)` is not supported on `str()`. Use `.weighted([...])` for biased string choice. */
  override normal(_mean: number, _stddev: number): this {
    throw new SchemaConflictError(
      'str: .normal(...) is not supported on string schemas.',
      [],
      'numeric distributions apply only to `num()`/`int()`. For biased string choice use `.weighted([["a", 1], ["b", 2]])`.',
    )
  }
  /** @deprecated `.typically(...)` is not supported on `str()`. */
  override typically(_from: number, _to: number): this {
    throw new SchemaConflictError(
      'str: .typically(...) is not supported on string schemas.',
      [],
      'numeric distributions apply only to `num()`/`int()`. For biased string choice use `.weighted([...])`.',
    )
  }
}

export const str = (): StringSchema =>
  new StringSchema({ kind: 'string', format: 'plain' })

// ──────────────────────────────────────────────────────────────────────────
// number / int
// ──────────────────────────────────────────────────────────────────────────

export class NumberSchema extends Schema<number> {
  declare readonly _node: NumberKind & { mods?: import('../foundation/ir.js').Modifiers }

  min(n: number): NumberSchema {
    return new NumberSchema({ ...this._node, min: n })
  }
  max(n: number): NumberSchema {
    return new NumberSchema({ ...this._node, max: n })
  }
}

export const num = (): NumberSchema =>
  new NumberSchema({ kind: 'number', int: false })

export const int = (): NumberSchema =>
  new NumberSchema({ kind: 'number', int: true })

// ──────────────────────────────────────────────────────────────────────────
// boolean / null
// ──────────────────────────────────────────────────────────────────────────

export const bool = (): Schema<boolean> => new Schema<boolean>({ kind: 'boolean' })

export const null_ = (): Schema<null> => new Schema<null>({ kind: 'null' })
