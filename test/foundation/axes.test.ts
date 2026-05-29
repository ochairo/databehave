/**
 * `mergeAxes` — direct unit tests.
 *
 * The function is exercised indirectly through the schema builders, but
 * each merge rule has its own contract we want to pin down here:
 *
 *   - `a === undefined`   → returns `b` unchanged (no-op short-circuit)
 *   - scalar axes         → right-hand wins (`b.distribution ?? a.distribution`)
 *   - list axes           → concatenate (`occasionally`, `eventually`, `invariants`)
 *   - empty result lists  → omitted from the output (no key set to `[]`)
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { mergeAxes, type Axes } from '../../src/foundation/axes.js'

describe('mergeAxes', () => {
  it('returns the right-hand side unchanged when left is undefined', () => {
    const b: Axes = { distribution: { kind: 'normal', mean: 0, stddev: 1 } }
    const m = mergeAxes(undefined, b)
    assert.equal(m, b, 'must return the exact same reference (no clone)')
  })

  it('returns an empty object when both sides have no fields', () => {
    const m = mergeAxes({}, {})
    assert.deepEqual(m, {})
  })

  it('right-hand scalar axes (distribution/derived/domain) win over left', () => {
    const a: Axes = {
      distribution: { kind: 'normal', mean: 0, stddev: 1 },
      domain: { kind: 'values', values: ['x'] },
      derived: () => 'a',
    }
    const b: Axes = {
      distribution: { kind: 'typical', from: 1, to: 2 },
      domain: { kind: 'values', values: ['y'] },
      derived: () => 'b',
    }
    const m = mergeAxes(a, b)
    assert.equal(m.distribution, b.distribution)
    assert.equal(m.domain, b.domain)
    assert.equal(m.derived, b.derived)
  })

  it('falls back to the left scalar when the right is missing', () => {
    const a: Axes = { distribution: { kind: 'typical', from: 0, to: 1 } }
    const m = mergeAxes(a, {})
    assert.equal(m.distribution, a.distribution)
  })

  it('concatenates list axes (occasionally / eventually / invariants)', () => {
    const a: Axes = {
      occasionally: [{ value: 1, p: 0.1 }],
      eventually: [{ value: 'x', every: 3 }],
      invariants: [() => true],
    }
    const b: Axes = {
      occasionally: [{ value: 2, p: 0.2 }],
      eventually: [{ value: 'y', every: 5 }],
      invariants: [() => false],
    }
    const m = mergeAxes(a, b)
    assert.equal(m.occasionally?.length, 2)
    assert.equal(m.eventually?.length, 2)
    assert.equal(m.invariants?.length, 2)
  })

  it('omits empty list-axis keys from the output', () => {
    const m = mergeAxes({}, {})
    assert.equal('occasionally' in m, false)
    assert.equal('eventually' in m, false)
    assert.equal('invariants' in m, false)
  })

  it('one-sided list contributions are preserved', () => {
    const m = mergeAxes({ invariants: [() => true] }, {})
    assert.equal(m.invariants?.length, 1)
  })
})
