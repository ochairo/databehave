import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { mulberry32, rngFromString, seedFromString } from '../../src/foundation/prng.js'

describe('mulberry32', () => {
  it('produces identical sequences for identical seeds', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 100; i += 1) {
      assert.equal(a.next(), b.next())
    }
  })

  it('next() returns values in [0, 1)', () => {
    const r = mulberry32(1)
    for (let i = 0; i < 1000; i += 1) {
      const v = r.next()
      assert.ok(v >= 0 && v < 1, `value out of range: ${v}`)
    }
  })

  it('int(min, max) is inclusive on both ends', () => {
    const r = mulberry32(7)
    let sawMin = false
    let sawMax = false
    for (let i = 0; i < 1000; i += 1) {
      const v = r.int(0, 4)
      assert.ok(Number.isInteger(v))
      assert.ok(v >= 0 && v <= 4)
      if (v === 0) sawMin = true
      if (v === 4) sawMax = true
    }
    assert.ok(sawMin, 'should occasionally produce min')
    assert.ok(sawMax, 'should occasionally produce max')
  })

  it('pick selects elements within the array', () => {
    const r = mulberry32(99)
    const items = ['a', 'b', 'c'] as const
    for (let i = 0; i < 100; i += 1) {
      assert.ok(items.includes(r.pick(items)))
    }
  })
})

describe('seedFromString / rngFromString', () => {
  it('identical strings → identical seed and identical first value', () => {
    assert.equal(seedFromString('hello'), seedFromString('hello'))
    const a = rngFromString('hello')
    const b = rngFromString('hello')
    assert.equal(a.next(), b.next())
  })

  it('different strings → different seeds', () => {
    assert.notEqual(seedFromString('a'), seedFromString('b'))
  })
})

describe('mulberry32 — runtime guards', () => {
  it('int() throws on non-finite bounds', () => {
    const r = mulberry32(1)
    assert.throws(() => r.int(Number.POSITIVE_INFINITY, 1), RangeError)
    assert.throws(() => r.int(0, Number.POSITIVE_INFINITY), RangeError)
    assert.throws(() => r.int(Number.NaN, 1), RangeError)
  })

  it('int() throws when min > max', () => {
    const r = mulberry32(1)
    assert.throws(() => r.int(10, 5), RangeError)
  })

  it('int() handles min === max as a constant', () => {
    const r = mulberry32(1)
    for (let i = 0; i < 10; i += 1) assert.equal(r.int(7, 7), 7)
  })

  it('pick() throws on an empty array', () => {
    const r = mulberry32(1)
    assert.throws(() => r.pick([]), RangeError)
  })

  it('pick() always returns a member of the array', () => {
    const r = mulberry32(1)
    const items = ['a', 'b', 'c'] as const
    for (let i = 0; i < 100; i += 1) {
      assert.ok(items.includes(r.pick(items)))
    }
  })
})
