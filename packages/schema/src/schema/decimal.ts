/**
 * Decimal — fixed-point numeric represented as a string for precision safety.
 *
 * Targets Snowflake / Postgres NUMERIC(precision, scale). Generated values are
 * always strings (e.g. `"123.4500000000000000000"` for scale=19) so callers
 * never lose precision through JavaScript number coercion.
 *
 * The inferred type is `string` for ergonomic interop with the rest of the
 * ecosystem. Callers needing a nominal brand can intersect via `Infer<typeof S>
 * & Brand` themselves; databehave intentionally avoids forcing a brand to keep
 * `decimal().default('0.0')` and JSON round-trips friction-free.
 */

import type { DecimalKind, Modifiers } from '../foundation/ir.js'
import { Continuous, Numeric, Schema } from '../foundation/types.js'

export class DecimalSchema extends Schema<string> {
  declare readonly _node: DecimalKind & { mods?: Modifiers }
  declare readonly [Numeric]: true
  declare readonly [Continuous]: true

  /** Inclusive lower bound. Pass as a numeric string. */
  min(value: string | number): DecimalSchema {
    return new DecimalSchema({ ...this._node, min: String(value) })
  }
  /** Inclusive upper bound. Pass as a numeric string. */
  max(value: string | number): DecimalSchema {
    return new DecimalSchema({ ...this._node, max: String(value) })
  }
}

/**
 * Declare a fixed-point decimal column.
 *
 * @param precision total significant digits (1..38 for Snowflake)
 * @param scale     digits after the decimal point (0..precision)
 */
export const decimal = (precision: number, scale: number): DecimalSchema => {
  if (!Number.isInteger(precision) || precision < 1 || precision > 38) {
    throw new RangeError(`decimal: precision must be integer in [1, 38], got ${precision}`)
  }
  if (!Number.isInteger(scale) || scale < 0 || scale > precision) {
    throw new RangeError(`decimal: scale must be integer in [0, precision], got ${scale}`)
  }
  return new DecimalSchema({ kind: 'decimal', precision, scale })
}
