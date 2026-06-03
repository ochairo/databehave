import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { SchemaConflictError } from '../../src/foundation/errors.js'
import { mock } from '../../src/generator/engine.js'
import {
  arr,
  ArraySchema,
  enum_,
  literal,
  obj,
  tuple,
  union,
} from '../../src/schema/composites.js'
import { decimal } from '../../src/schema/decimal.js'
import { bool, int, num, str } from '../../src/schema/primitives.js'
import { parse, safeParse } from '../../src/validator/parse.js'

describe('mock — determinism', () => {
  it('identical schema + seed → identical output', () => {
    const schema = obj({ x: int().min(1).max(100), y: str() })
    const a = mock(schema, { seed: 'deterministic' })
    const b = mock(schema, { seed: 'deterministic' })
    assert.deepEqual(a, b)
  })

  it('different seeds → different outputs (in most cases)', () => {
    const schema = obj({ x: int().min(0).max(1_000_000) })
    const a = mock(schema, { seed: 'seed-a' })
    const b = mock(schema, { seed: 'seed-b' })
    assert.notDeepEqual(a, b)
  })
})

describe('mock — primitives', () => {
  it('str produces a string', () => {
    const v = mock(str(), { seed: 's' })
    assert.equal(typeof v, 'string')
  })

  it('int respects min/max', () => {
    for (let i = 0; i < 50; i += 1) {
      const v = mock(int().min(10).max(20), { seed: `int-${i}` })
      assert.ok(Number.isInteger(v))
      assert.ok(v >= 10 && v <= 20, `value out of range: ${v}`)
    }
  })

  it('num produces a number', () => {
    const v = mock(num().min(0).max(1), { seed: 'n' })
    assert.equal(typeof v, 'number')
    assert.ok(v >= 0 && v <= 1)
  })

  it('bool produces a boolean', () => {
    const v = mock(bool(), { seed: 'b' })
    assert.equal(typeof v, 'boolean')
  })
})

describe('mock — decimal', () => {
  it('decimal(38, 19) produces a numeric string with the requested scale', () => {
    const v = mock(decimal(38, 19).min('100').max('300'), { seed: 'dec' })
    assert.equal(typeof v, 'string')
    const [, frac = ''] = v.split('.')
    assert.equal(frac.length, 19, `expected 19 fractional digits, got ${frac.length}: ${v}`)
    assert.ok(/^-?\d+\.\d+$/.test(v), `not a decimal string: ${v}`)
  })

  it('decimal default bounds work without explicit min/max', () => {
    const v = mock(decimal(10, 2), { seed: 'dec-default' })
    assert.equal(typeof v, 'string')
    assert.ok(/^\d+\.\d{2}$/.test(v), `unexpected format: ${v}`)
  })
})

describe('mock — composites', () => {
  it('obj generates all required fields', () => {
    const schema = obj({ a: str(), b: int(), c: bool() })
    const v = mock(schema, { seed: 'obj' })
    assert.equal(typeof v.a, 'string')
    assert.equal(typeof v.b, 'number')
    assert.equal(typeof v.c, 'boolean')
  })

  it('arr generates an array of the item type', () => {
    const schema = arr(int().min(0).max(10)).length(5)
    const v = mock(schema, { seed: 'arr' })
    assert.equal(v.length, 5)
    for (const x of v) {
      assert.ok(Number.isInteger(x) && x >= 0 && x <= 10)
    }
  })

  it('tuple generates fixed-length heterogeneous arrays', () => {
    const schema = tuple(str(), int(), bool())
    const v = mock(schema, { seed: 'tup' })
    assert.equal(v.length, 3)
    assert.equal(typeof v[0], 'string')
    assert.equal(typeof v[1], 'number')
    assert.equal(typeof v[2], 'boolean')
  })

  it('union produces one of the option types', () => {
    const schema = union(literal('A'), literal('B'), literal('C'))
    for (let i = 0; i < 50; i += 1) {
      const v = mock(schema, { seed: `u-${i}` })
      assert.ok(v === 'A' || v === 'B' || v === 'C')
    }
  })

  it('enum_ picks from declared values', () => {
    const schema = enum_(['x', 'y', 'z'] as const)
    for (let i = 0; i < 30; i += 1) {
      const v = mock(schema, { seed: `e-${i}` })
      assert.ok(['x', 'y', 'z'].includes(v))
    }
  })
})

describe('mock — nested realistic example', () => {
  it('nested object/array response shape generates and parses', () => {
    const CatalogRow = obj({
      record_date: str(),
      item_id: int().min(1).max(99),
      quantity: decimal(38, 19).min('0').max('1000000'),
      remarks: str().nullable(),
    })
    const Response = obj({
      group_code: literal('A'),
      table: arr(CatalogRow).length(7),
    })
    const v = mock(Response, { seed: 'nested' })
    assert.equal(v.group_code, 'A')
    assert.equal(v.table.length, 7)
    parse(Response, v) // must round-trip
  })
})

describe('parse / safeParse', () => {
  it('parse accepts valid values', () => {
    const schema = obj({ x: int().min(0).max(10) })
    assert.deepEqual(parse(schema, { x: 5 }), { x: 5 })
  })

  it('parse throws ConformError on bad shape', () => {
    const schema = obj({ x: int() })
    assert.throws(
      () => parse(schema, { x: 'not a number' }),
      /expected number/,
    )
  })

  it('safeParse returns { ok: false } with issues on failure', () => {
    const schema = obj({ x: int().min(10) })
    const r = safeParse(schema, { x: 5 })
    assert.equal(r.ok, false)
    if (r.ok === false) {
      assert.ok(r.error.issues.length >= 1)
      assert.equal(r.error.issues[0]?.path[0], 'x')
    }
  })

  it('decimal scale violation is detected', () => {
    const schema = decimal(38, 2)
    const r = safeParse(schema, '123.456')
    assert.equal(r.ok, false)
    if (r.ok === false) {
      assert.match(r.error.issues[0]?.message ?? '', /scale .* exceeds/)
    }
  })

  it('nullable accepts null', () => {
    const schema = str().nullable()
    assert.equal(parse(schema, null), null)
  })

  it('optional accepts undefined and omits from object', () => {
    const schema = obj({ a: str(), b: str().optional() })
    assert.deepEqual(parse(schema, { a: 'x' }), { a: 'x' })
  })
})

// ────────────────────────────────────────────────────────────────────────
// modifierProbs — opt-in randomness for `.optional()` / `.nullable()`.
// Default is OFF: an `.optional()` field is always present, a `.nullable()`
// field is always non-null. Users opt in with `modifierProbs`.
// ────────────────────────────────────────────────────────────────────────

describe('mock — modifierProbs (opt-in randomness)', () => {
  const Row = obj({ a: str().optional(), b: str().nullable() })

  it('default behavior is deterministic-present / non-null', () => {
    for (let i = 0; i < 20; i += 1) {
      const v = mock(Row, { seed: `def-${i}` })
      assert.ok('a' in v && typeof v.a === 'string')
      assert.ok(v.b !== null && typeof v.b === 'string')
    }
  })

  it('opt-in via `{ optional: 1, nullable: 1 }` makes both always absent/null', () => {
    for (let i = 0; i < 20; i += 1) {
      const v = mock(Row, { seed: `on-${i}`, modifierProbs: { optional: 1, nullable: 1 } }) as Record<string, unknown>
      assert.ok(!('a' in v))
      assert.equal(v['b'], null)
    }
  })

  it('opt-in at intermediate probability hits both branches', () => {
    let absent = 0
    let nulls = 0
    for (let i = 0; i < 400; i += 1) {
      const v = mock(Row, { seed: `m-${i}`, modifierProbs: { optional: 0.5, nullable: 0.5 } }) as Record<string, unknown>
      if (!('a' in v)) absent += 1
      if (v['b'] === null) nulls += 1
    }
    assert.ok(absent > 100 && absent < 300, `absent=${absent}`)
    assert.ok(nulls > 100 && nulls < 300, `nulls=${nulls}`)
  })

  it('shallow-merges over zero defaults (omitted keys remain off)', () => {
    // Only `optional` is set; `nullable` stays at the default 0.
    let absent = 0
    let nulls = 0
    for (let i = 0; i < 100; i += 1) {
      const v = mock(Row, { seed: `mix-${i}`, modifierProbs: { optional: 1 } }) as Record<string, unknown>
      if (!('a' in v)) absent += 1
      if (v['b'] === null) nulls += 1
    }
    assert.equal(absent, 100, 'optional=1 must fire every time')
    assert.equal(nulls, 0, 'nullable stays at default 0')
  })

  it('rejects out-of-range probabilities with a RangeError', () => {
    assert.throws(
      () => mock(Row, { seed: 's', modifierProbs: { optional: 1.5 } }),
      RangeError,
    )
    assert.throws(
      () => mock(Row, { seed: 's', modifierProbs: { default: -0.1 } }),
      RangeError,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────
// Numeric/structural bound contradictions are reported by the generator,
// not the builder, because `.min()` and `.max()` return fresh schemas.
// ────────────────────────────────────────────────────────────────────────

describe('mock — bound contradictions throw SchemaConflictError', () => {
  it('number min > max', () => {
    assert.throws(() => mock(num().min(10).max(1), { seed: 's' }), SchemaConflictError)
  })

  it('decimal min > max', () => {
    assert.throws(
      () => mock(decimal(5, 2).min('10').max('1'), { seed: 's' }),
      SchemaConflictError,
    )
  })

  it('array minLength > maxLength (via direct ArraySchema)', () => {
    assert.throws(
      () => mock(new ArraySchema(int(), { minLength: 5, maxLength: 1 }), { seed: 's' }),
      SchemaConflictError,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────
// Domain × distribution composition: when a `lookup` domain narrows the
// allowed set, a `.weighted([...])` distribution over the broader set must
// stay within the lookup intersection.
// ────────────────────────────────────────────────────────────────────────

describe('mock — lookup × weighted composition', () => {
  it('weighted skew only applies within the lookup-allowed subset', () => {
    const schema = obj({
      g: str().in(['A', 'B']),
      code: str()
        .in({ kind: 'lookup', fromField: 'g', map: { A: ['x', 'y'], B: ['z'] } })
        .weighted([
          ['x', 0.9],
          ['y', 0.05],
          ['z', 0.05],
        ]),
    })
    for (let i = 0; i < 50; i += 1) {
      const v = mock(schema, { seed: `lw-${i}` })
      if (v.g === 'A') assert.ok(v.code === 'x' || v.code === 'y')
      else assert.equal(v.code, 'z')
    }
  })
})

// ────────────────────────────────────────────────────────────────────────
// Lookup-domain fallbacks: when the sibling key isn't a string, or when
// the key isn't present in the map (or maps to an empty list), the domain
// sampler returns `undefined` and the engine falls through to the kind's
// default generator. We assert by observing that the result is NOT drawn
// from the lookup table (i.e. the lookup did not constrain the value).
// ────────────────────────────────────────────────────────────────────────

describe('mock — lookup domain fallback paths', () => {
  it('falls through to default generation when the sibling key is not a string', () => {
    // `g` is an int, but the lookup map is keyed by string — the lookup
    // cannot dispatch, so `code` is sampled as an unconstrained string.
    const schema = obj({
      g: int().min(0).max(0),
      code: str().in({ kind: 'lookup', fromField: 'g', map: { A: ['ONLY'] } }),
    })
    let sawNonMapValue = false
    for (let i = 0; i < 10; i += 1) {
      const v = mock(schema, { seed: `kv-not-string-${i}` }) as { code: string }
      if (v.code !== 'ONLY') {
        sawNonMapValue = true
        break
      }
    }
    assert.ok(sawNonMapValue, 'expected fallback to default str() generation')
  })

  it('falls through when the sibling key has no entry in the map', () => {
    const schema = obj({
      g: str().in(['A', 'B', 'C']),
      code: str().in({ kind: 'lookup', fromField: 'g', map: { A: ['ONLY'], B: ['ONLY'] } }),
    })
    // Drive the seed until `g === 'C'` (no map entry → fallback fires).
    let sawMiss = false
    for (let i = 0; i < 200; i += 1) {
      const v = mock(schema, { seed: `miss-${i}` }) as { g: string; code: string }
      if (v.g === 'C') {
        assert.notEqual(v.code, 'ONLY')
        sawMiss = true
        break
      }
    }
    assert.ok(sawMiss, "never observed g === 'C' to exercise the miss branch")
  })

  it('falls through when the map entry is an empty candidate list', () => {
    const schema = obj({
      g: str().in(['A']),
      code: str().in({ kind: 'lookup', fromField: 'g', map: { A: [] } }),
    })
    // Empty candidate list → undefined from sampleFromDomain → default str().
    let sawDefault = false
    for (let i = 0; i < 10; i += 1) {
      const v = mock(schema, { seed: `empty-${i}` }) as { code: string }
      if (typeof v.code === 'string' && v.code.length > 0) {
        sawDefault = true
        break
      }
    }
    assert.ok(sawDefault)
  })
})

void bool
void tuple
void union
void literal
void arr
