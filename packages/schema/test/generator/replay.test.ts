/**
 * replay() and expectStable() — determinism contract.
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import {
  arr,
  expectStable,
  int,
  null_,
  obj,
  replay,
  str,
} from '../../src/index.js'

describe('replay()', () => {
  it('returns the same value on repeated calls', () => {
    const gen = replay(obj({ id: int().min(0).max(1000), name: str() }), { seed: 'fix-1' })
    const a = gen()
    const b = gen()
    assert.deepEqual(a, b)
  })

  it('freezes the supplied options', () => {
    const gen = replay(int(), { seed: 'fixed' })
    assert.ok(Object.isFrozen(gen.options))
    assert.equal(gen.options.seed, 'fixed')
  })

  it('defaults options to {} when omitted', () => {
    const gen = replay(int().min(0).max(10))
    // Two calls with the same (empty) options must still be deep-equal.
    assert.deepEqual(gen(), gen())
  })

  it('different seeds produce different values for the same schema', () => {
    const s = arr(int().min(0).max(1_000_000)).length(5)
    const a = replay(s, { seed: 'A' })()
    const b = replay(s, { seed: 'B' })()
    assert.notDeepEqual(a, b)
  })
})

describe('expectStable()', () => {
  it('returns the value when generation is deterministic', () => {
    const v = expectStable(obj({ id: int().min(0).max(99) }), { seed: 'stable' })
    assert.ok(typeof v.id === 'number')
  })

  it('throws when derivedFrom returns different values on repeated invocations', () => {
    // Closure counter → non-deterministic derived value.
    let calls = 0
    const naughty = obj({
      seq: int().derivedFrom(() => {
        calls += 1
        return calls
      }),
    })
    assert.throws(() => expectStable(naughty, { seed: 's' }), /expectStable/)
  })

  it('treats arrays of different length as divergent', () => {
    // Use derivedFrom with a counter to vary array length-derived field.
    let i = 0
    const schema = obj({
      pickedFromIndex: int().derivedFrom(() => {
        i += 1
        return i
      }),
    })
    assert.throws(() => expectStable(schema, { seed: 'x' }))
  })

  it('detects divergence inside nested arrays', () => {
    let i = 0
    const schema = obj({
      tags: arr(
        int().derivedFrom(() => {
          i += 1
          return i
        }),
      ).length(3),
    })
    assert.throws(() => expectStable(schema, { seed: 'arr' }))
  })

  it('detects divergence inside nested objects', () => {
    let i = 0
    const schema = obj({
      meta: obj({
        seq: int().derivedFrom(() => {
          i += 1
          return i
        }),
      }),
    })
    assert.throws(() => expectStable(schema, { seed: 'nested' }))
  })

  it('accepts schemas containing null-valued fields', () => {
    // Exercises the null short-circuit branch of deepEqual on both sides.
    const schema = obj({ note: null_() })
    const v = expectStable(schema, { seed: 'null-eq' })
    assert.equal(v.note, null)
  })
})

describe('replay() — deep-freeze', () => {
  it('freezes nested option fields, not just the top level', () => {
    const opts = { seed: 'deep', input: { nested: { a: 1 } } } as Record<string, unknown>
    const gen = replay(int(), opts)
    const frozen = gen.options as { input: { nested: { a: number } } }
    assert.ok(Object.isFrozen(frozen))
    assert.ok(Object.isFrozen(frozen.input))
    assert.ok(Object.isFrozen(frozen.input.nested))
  })

  it('is idempotent when options are already frozen (re-entry)', () => {
    const opts = Object.freeze({ seed: 'frozen', input: Object.freeze({ a: 1 }) })
    const gen = replay(int().min(0).max(5), opts)
    assert.doesNotThrow(() => gen())
  })
})
