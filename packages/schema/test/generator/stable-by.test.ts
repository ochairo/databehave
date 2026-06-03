import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { mock } from '../../src/generator/engine.js'
import { arr, enum_, obj } from '../../src/schema/composites.js'
import { decimal } from '../../src/schema/decimal.js'
import { bool, int, str } from '../../src/schema/primitives.js'

describe('mock — stableBy', () => {
  it('returning non-null key freezes leaf values across seeds', () => {
    const schema = obj({
      n: int().min(0).max(1_000_000),
      d: decimal(6, 2).min('0').max('9999'),
      s: str(),
      b: bool(),
      e: enum_(['a', 'b', 'c', 'd', 'e'] as const),
    })
    const a = mock(schema, { seed: 'seedA', stableBy: () => 'fixed' })
    const b = mock(schema, { seed: 'totally-different', stableBy: () => 'fixed' })
    assert.deepEqual(a, b)
  })

  it('returning null falls back to shared rng (seed-dependent)', () => {
    const schema = obj({ n: int().min(0).max(1_000_000) })
    const a = mock(schema, { seed: 'seedA', stableBy: () => null })
    const b = mock(schema, { seed: 'seedB', stableBy: () => null })
    assert.notDeepEqual(a, b)
  })

  it('per-row toggle: fixed prefix is stable, suffix follows seed', () => {
    const schema = obj({
      rows: arr(obj({ v: int().min(0).max(1_000_000) })).length(10),
    })
    const stableBy = (ctx: { index?: number }): string | null =>
      (ctx.index ?? -1) < 3 ? `row-${ctx.index}` : null
    const a = mock(schema, { seed: 'A', stableBy })
    const b = mock(schema, { seed: 'B', stableBy })
    // First 3 rows must match.
    assert.deepEqual(a.rows.slice(0, 3), b.rows.slice(0, 3))
    // Suffix should differ across seeds (statistically true with int 0..1e6).
    assert.notDeepEqual(a.rows.slice(3), b.rows.slice(3))
  })

  it('omitting stableBy keeps previous behavior bit-for-bit', () => {
    const schema = obj({ x: int().min(0).max(1_000_000), y: str() })
    const a = mock(schema, { seed: 'baseline' })
    const b = mock(schema, { seed: 'baseline', stableBy: () => null })
    assert.deepEqual(a, b)
  })

  it('stable key is path-scoped: same row, different fields → different values', () => {
    const schema = obj({
      a: int().min(0).max(1_000_000),
      b: int().min(0).max(1_000_000),
    })
    const v = mock(schema, { seed: 's', stableBy: () => 'k' })
    assert.notEqual(v.a, v.b)
  })
})
