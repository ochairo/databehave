/**
 * `decimal(precision, scale)` — generation precision.
 *
 * The shape-level tests for `decimal` (precision/scale guards, IR, parse
 * scale check) live alongside the other builder/validator suites. This file
 * focuses on the *generator's* numeric correctness: uniform sampling must
 * preserve full BigInt precision at scale 38 and respect bounds that
 * exceed the safe Number range.
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { decimal, mock, parse } from '../../src/index.js'
import { SchemaConflictError } from '../../src/foundation/errors.js'

describe('decimal — generation precision', () => {
  it('produces the requested fractional digit count at scale 38', () => {
    const D = decimal(38, 38)
      .min('0')
      .max('0.99999999999999999999999999999999999999')
    for (let i = 0; i < 25; i += 1) {
      const v = mock(D, { seed: `p-${i}` })
      assert.match(v, /^0\.\d{38}$/, `unexpected format: ${v}`)
      assert.doesNotThrow(() => parse(D, v), `round-trip failed for ${v}`)
    }
  })

  it('uses BigInt arithmetic so bounds beyond Number precision still round-trip', () => {
    const D = decimal(38, 0)
      .min('100000000000000000000000000000000000000')
      .max('100000000000000000000000000000000000005')
    for (let i = 0; i < 10; i += 1) {
      const v = mock(D, { seed: `b-${i}` })
      assert.match(v, /^10000000000000000000000000000000000000[0-5]$/, v)
    }
  })

  it('rejects min > max at generation time', () => {
    assert.throws(
      () => mock(decimal(5, 2).min('5').max('1'), { seed: 's' }),
      SchemaConflictError,
    )
  })

  it('rejects non-numeric string bounds at generation time', () => {
    assert.throws(
      () => mock(decimal(5, 2).min('abc'), { seed: 's' }),
      SchemaConflictError,
    )
    assert.throws(
      () => mock(decimal(5, 2).max('1.2.3'), { seed: 's' }),
      SchemaConflictError,
    )
  })
})

describe('decimal — builder guards', () => {
  it('rejects precision outside [1, 38]', () => {
    assert.throws(() => decimal(0, 0), RangeError)
    assert.throws(() => decimal(39, 0), RangeError)
    assert.throws(() => decimal(1.5, 0), RangeError)
  })

  it('rejects scale outside [0, precision]', () => {
    assert.throws(() => decimal(10, -1), RangeError)
    assert.throws(() => decimal(10, 11), RangeError)
    assert.throws(() => decimal(10, 1.5), RangeError)
  })

  it('accepts valid precision/scale combinations', () => {
    assert.doesNotThrow(() => decimal(1, 0))
    assert.doesNotThrow(() => decimal(38, 38))
    assert.doesNotThrow(() => decimal(10, 5))
  })

  it('.min / .max accept both string and number and stringify them', () => {
    const node1 = decimal(10, 2).min(1).max(99)._node
    const node2 = decimal(10, 2).min('1').max('99')._node
    assert.equal(node1.min, '1')
    assert.equal(node1.max, '99')
    assert.deepEqual(node1, node2)
  })
})
