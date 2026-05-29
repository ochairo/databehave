import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { mock } from '../../src/generator/engine.js'
import { arr, enum_, literal, obj } from '../../src/schema/composites.js'
import { discriminated } from '../../src/schema/conditional.js'
import { decimal } from '../../src/schema/decimal.js'
import { bool, int, num, str } from '../../src/schema/primitives.js'

describe('axes — distribution', () => {
  it('weighted distribution biases toward heavy values', () => {
    const schema = enum_(['A', 'B', 'C'] as const).weighted([
      ['A', 0.9],
      ['B', 0.05],
      ['C', 0.05],
    ])
    let aCount = 0
    for (let i = 0; i < 200; i += 1) {
      if (mock(schema, { seed: `w-${i}` }) === 'A') aCount += 1
    }
    assert.ok(aCount > 150, `expected ~90% A but got ${aCount}/200`)
  })

  it('typically(from,to) keeps values within the typical range', () => {
    const schema = num().min(0).max(100).typically(40, 60)
    for (let i = 0; i < 50; i += 1) {
      const v = mock(schema, { seed: `t-${i}` })
      assert.ok(v >= 40 && v <= 60, `out of typical range: ${v}`)
    }
  })

  it('normal distribution stays within hard bounds via clamping', () => {
    const schema = num().min(0).max(10).normal(5, 3)
    for (let i = 0; i < 100; i += 1) {
      const v = mock(schema, { seed: `n-${i}` })
      assert.ok(v >= 0 && v <= 10, `clamped value out of bounds: ${v}`)
    }
  })

  it('occasionally(value, 1.0) forces the value every time', () => {
    const schema = int().min(0).max(100).occasionally(999, 1)
    for (let i = 0; i < 20; i += 1) {
      assert.equal(mock(schema, { seed: `o-${i}` }), 999)
    }
  })

  it('occasionally(value, 0) never forces the value', () => {
    const schema = int().min(0).max(100).occasionally(999, 0)
    for (let i = 0; i < 20; i += 1) {
      assert.notEqual(mock(schema, { seed: `o-${i}` }), 999)
    }
  })
})

describe('axes — domain', () => {
  it('in([...]) restricts string to enumerated values', () => {
    const schema = str().in(['alpha', 'beta', 'gamma'])
    for (let i = 0; i < 30; i += 1) {
      const v = mock(schema, { seed: `d-${i}` })
      assert.ok(['alpha', 'beta', 'gamma'].includes(v))
    }
  })

  it('lookup domain selects from a sibling-keyed map', () => {
    const schema = obj({
      group: str().in(['A', 'B']),
      code: str().in({
        kind: 'lookup',
        fromField: 'group',
        map: { A: ['T1', 'T2', 'T3'], B: ['X', 'Y'] },
      }),
    })
    for (let i = 0; i < 50; i += 1) {
      const v = mock(schema, { seed: `lk-${i}` })
      if (v.group === 'A') {
        assert.ok(['T1', 'T2', 'T3'].includes(v.code))
      } else {
        assert.ok(['X', 'Y'].includes(v.code))
      }
    }
  })
})

describe('axes — derived', () => {
  it('derivedFrom reads other sibling fields', () => {
    const schema = obj({
      qty: int().min(1).max(10),
      unit_price: int().min(100).max(1000),
      total: int().derivedFrom(
        (ctx) => (ctx.parent.qty as number) * (ctx.parent.unit_price as number),
      ),
    })
    const v = mock(schema, { seed: 'der' })
    assert.equal(v.total, v.qty * v.unit_price)
  })
})

describe('axes — invariants', () => {
  it('invariant rejection produces a value that satisfies it', () => {
    const schema = int().min(0).max(100).invariant((v) => (v as number) % 2 === 0)
    for (let i = 0; i < 30; i += 1) {
      const v = mock(schema, { seed: `i-${i}` })
      assert.equal(v % 2, 0)
    }
  })

  it('infeasible invariant throws SchemaConflictError', () => {
    const schema = int().min(0).max(5).invariant((v) => (v as number) > 100)
    assert.throws(() => mock(schema, { seed: 'fail' }), /invariant unsatisfied/)
  })
})

describe('axes — discriminated', () => {
  it('discriminated picks one of the keyed branches', () => {
    const Variant = discriminated('kind', {
      alpha: obj({ kind: literal('alpha'), score:  decimal(10, 4) }),
      beta:  obj({ kind: literal('beta'),  weight: decimal(10, 4) }),
    })
    for (let i = 0; i < 20; i += 1) {
      const v = mock(Variant, { seed: `f-${i}` }) as { kind: string }
      assert.ok(v.kind === 'alpha' || v.kind === 'beta')
    }
  })
})

describe('axes — nested with arr', () => {
  it('typically + arr length combine cleanly', () => {
    const Row = obj({
      idx: int().min(1).max(7),
      quantity: decimal(38, 19).min('0').max('1000').typically(200, 800),
    })
    const v = mock(arr(Row).length(5), { seed: 'nest' })
    assert.equal(v.length, 5)
    for (const row of v) {
      const n = Number(row.quantity)
      assert.ok(n >= 200 && n <= 800)
    }
  })
})

// Suppress unused-import warning for bool — kept for symmetry with other test suites.
void bool

describe('axis builders — runtime guards', () => {
  it('occasionally() rejects p outside [0, 1]', () => {
    assert.throws(() => int().occasionally(0, -0.01), RangeError)
    assert.throws(() => int().occasionally(0, 1.01), RangeError)
    assert.doesNotThrow(() => int().occasionally(0, 0))
    assert.doesNotThrow(() => int().occasionally(0, 1))
  })

  it('eventually() rejects non-positive-integer cadence', () => {
    assert.throws(() => int().eventually(0, 0), RangeError)
    assert.throws(() => int().eventually(-1, 0), RangeError)
    assert.throws(() => int().eventually(1.5, 0), RangeError)
    assert.doesNotThrow(() => int().eventually(1, 0))
  })
})
