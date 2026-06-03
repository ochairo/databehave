/**
 * Cross-dataset FK identity — declarative foreign-key lookup.
 *
 * `relate(rows, field)` returns a `DerivedFn` suitable for `.derivedFrom(...)`
 * that picks one row from a previously-generated dataset and returns its
 * `field` value. Selection is deterministic, driven by the generator seed,
 * so re-runs with the same seed produce the same FK assignments.
 *
 * ```ts
 * const Groups = mockDataset({ name: 'groups', schema: Group, identity: ['group_code'], n: 5 })
 *
 * const Item = obj({
 *   item_id:    str(),
 *   group_code: str().derivedFrom(relate(Groups, 'group_code')),  // FK
 * })
 * ```
 *
 * For ad-hoc cross-row selection (e.g. by index or condition), use the
 * `pickBy` option.
 */

import type { DerivedFn, GenContext } from '../foundation/axes.js'
import { mulberry32, seedFromString } from '../foundation/prng.js'

export type RelateOptions = {
  /**
   * Strategy to pick a row.
   *   - `'random'` (default): seeded uniform sample
   *   - `'index'`            : `rows[ctx.index % rows.length]`
   *   - `(ctx) => number`    : custom index resolver
   */
  readonly pickBy?: 'random' | 'index' | ((ctx: GenContext) => number)
}

export const relate = <R extends Record<string, unknown>, K extends Extract<keyof R, string>>(
  rows: readonly R[],
  field: K,
  opts: RelateOptions = {},
): DerivedFn<R[K]> => {
  if (rows.length === 0) {
    throw new RangeError(`relate: empty dataset (cannot pick field "${field}")`)
  }
  const strategy = opts.pickBy ?? 'random'
  return (ctx: GenContext): R[K] => {
    let idx: number
    if (strategy === 'index') {
      idx = (ctx.index ?? 0) % rows.length
    } else if (typeof strategy === 'function') {
      // `((x % n) + n) % n` normalises negative results into [0, n)
      // without the cost of `Math.abs` (which also changes magnitude).
      const n = rows.length
      idx = ((strategy(ctx) % n) + n) % n
    } else {
      // Deterministic uniform: derive a sub-RNG from the path-bound seed.
      const rng = mulberry32(seedFromString(`${ctx.seed}|relate|${field}`))
      idx = Math.floor(rng.next() * rows.length)
    }
    return (rows[idx] as R)[field]
  }
}
