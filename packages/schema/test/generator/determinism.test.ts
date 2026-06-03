/**
 * Phase 9 — determinism contract regression suite.
 *
 * Two complementary guards:
 *
 *   1. **Property** — for a representative cross-section of schemas
 *      and seeds, `mock(s, seed)` must equal `mock(s, seed)` byte-for-
 *      byte across repeated calls. This catches accidental
 *      `Math.random()` introductions, hidden module-level state,
 *      and any non-PRNG entropy source.
 *
 *   2. **Regression** — a small frozen table of `(schema-id, seed,
 *      expected JSON)` tuples pins a handful of outputs so PRNG
 *      changes are blocked from entering PATCH / MINOR. The version
 *      contract (`docs/stability.md`) reserves PRNG output changes
 *      for MAJOR; this test enforces that contract.
 *
 * The fixture table is intentionally small (one tuple per schema
 * kind) — its job is to detect *change*, not to test the engine.
 */
import { describe, it } from 'node:test'
import { strict as assert } from 'node:assert'

import {
  arr,
  bool,
  decimal,
  discriminated,
  enum_,
  int,
  literal,
  mock,
  obj,
  Schema,
  str,
  tuple,
  union,
} from '../../src/index.js'

// ── 1. property: same (schema, seed) ⇒ same output (×200 cases) ────────
describe('determinism — property', () => {
  const schemas: ReadonlyArray<readonly [string, Schema<unknown>]> = [
    ['primitives', obj({ a: int().min(0).max(1000), b: str().min(1).max(8), c: bool() })],
    ['nested', obj({ outer: arr(obj({ k: int(), v: str() })).min(1).max(5) })],
    ['decimal-range', obj({ price: decimal(10, 2).min('0').max('100').typically(10, 90) })],
    [
      'discriminated',
      obj({
        ev: discriminated('kind', {
          a: obj({ kind: literal('a'), n: int() }),
          b: obj({ kind: literal('b'), s: str() }),
        }),
      }),
    ],
    ['enum-weighted', obj({ status: enum_(['on', 'off', 'idle'] as const).weighted([['on', 1], ['off', 2], ['idle', 1]]) })],
    ['tuple', obj({ pair: tuple(int().min(0).max(9), str().min(2).max(4)) })],
    ['union-of-prims', obj({ v: union(int(), bool()) })],
  ]

  for (const [name, schema] of schemas) {
    it(`${name}: 25 seeds × 2 invocations match exactly`, () => {
      for (let i = 0; i < 25; i += 1) {
        const seed = `prop-${name}-${i}`
        const a = mock(schema, { seed })
        const b = mock(schema, { seed })
        assert.deepStrictEqual(
          a,
          b,
          `seed=${seed}: second invocation diverged — PRNG/state leaked`,
        )
        // Also confirm JSON serialisation is identical (catches Map/Set
        // ordering and non-enumerable property drift).
        assert.strictEqual(JSON.stringify(a), JSON.stringify(b))
      }
    })
  }

  it('different seeds produce different outputs (collision sanity)', () => {
    const schema = obj({ id: int().min(0).max(1_000_000), name: str().min(4).max(12) })
    const seen = new Set<string>()
    for (let i = 0; i < 50; i += 1) {
      seen.add(JSON.stringify(mock(schema, { seed: `coll-${i}` })))
    }
    // 50 distinct seeds with a >>50 cardinality schema should produce
    // 50 distinct outputs; a single collision indicates a serious
    // entropy bug in seedFromString / mulberry32.
    assert.strictEqual(seen.size, 50, 'seed → output collisions detected')
  })
})

// ── 2. regression: frozen tuples pin PRNG behaviour per MAJOR ──────────
//
// Updating these values is a SemVer MAJOR change (PRNG output drift).
// Bump `databehave` to the next major and document the diff in
// CHANGELOG.md before regenerating.
describe('determinism — regression (PRNG output frozen until MAJOR)', () => {
  const cases: ReadonlyArray<{
    readonly id: string
    readonly schema: Schema<unknown>
    readonly seed: string
    readonly expected: unknown
  }> = [
    {
      id: 'int-bounded',
      schema: obj({ n: int().min(0).max(99) }),
      seed: 'regression-int-bounded',
      expected: { n: 43 },
    },
    {
      id: 'str-length',
      schema: obj({ s: str().min(4).max(8) }),
      seed: 'regression-str-length',
      expected: { s: 'd6vKW' },
    },
    {
      id: 'decimal-typically',
      schema: obj({ p: decimal(10, 2).min('0').max('100').typically(20, 80) }),
      seed: 'regression-decimal-typically',
      expected: { p: '40.70' },
    },
  ]

  for (const c of cases) {
    it(`${c.id}: output frozen for seed=${c.seed}`, () => {
      const actual = mock(c.schema, { seed: c.seed })
      assert.deepStrictEqual(actual, c.expected)
    })
  }
})

// ── 3. modifier orthogonality: chaining axes does not introduce order
// dependence on a fixed seed (specifically, .occasionally + numeric
// distribution should commute). ───────────────────────────────────────
describe('determinism — modifier order independence within a single chain', () => {
  it('decimal: .min before .max yields same result as .max before .min', () => {
    const a = mock(obj({ v: decimal(10, 2).min('0').max('500') }), { seed: 'order-1' })
    const b = mock(obj({ v: decimal(10, 2).max('500').min('0') }), { seed: 'order-1' })
    assert.deepStrictEqual(a, b)
  })

  it('int: .min/.max ordering is commutative', () => {
    const a = mock(obj({ v: int().min(10).max(20) }), { seed: 'order-2' })
    const b = mock(obj({ v: int().max(20).min(10) }), { seed: 'order-2' })
    assert.deepStrictEqual(a, b)
  })
})
