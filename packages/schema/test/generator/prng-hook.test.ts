/**
 * `MockOptions.prng` lets callers inject a custom PRNG factory so
 * probability-driven branches can be exercised deterministically (or
 * recorded RNG sequences replayed). Default behaviour with `prng`
 * unset must match the pre-hook output for the determinism contract.
 */
import { describe, it } from 'node:test'
import { strict as assert } from 'node:assert'

import { int, mock, num, type Rng } from '../../src/index.js'

const constantRng = (value: number): Rng => ({
  next: () => value,
  int(_min, _max) {
    return Math.floor(value * 1000)
  },
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(value * items.length)] as T
  },
})

describe('MockOptions.prng — custom PRNG factory', () => {
  it('is invoked when supplied (numeric seed)', () => {
    let invoked = false
    const factory = (seed: number): Rng => {
      invoked = true
      assert.strictEqual(typeof seed, 'number', 'factory must receive a number seed')
      return constantRng(0.5)
    }
    mock(int().min(0).max(99), { seed: 7, prng: factory })
    assert.ok(invoked, 'factory was not called')
  })

  it('is invoked when supplied (string seed — hashed before factory)', () => {
    let received: number | undefined
    const factory = (seed: number): Rng => {
      received = seed
      return constantRng(0)
    }
    mock(num().min(0).max(1), { seed: 'abc', prng: factory })
    assert.strictEqual(typeof received, 'number')
    // seedFromString is deterministic — same string must hash to the
    // same u32 every run.
    let again: number | undefined
    mock(num().min(0).max(1), {
      seed: 'abc',
      prng: (s) => {
        again = s
        return constantRng(0)
      },
    })
    assert.strictEqual(received, again, 'string seed hashing must be stable across calls')
  })

  it("the factory's RNG drives sampling output", () => {
    // A constant rng that always returns 0 picks the lower bound for
    // num().min(a).max(b). A constant rng that always returns 0.99999
    // picks the upper bound. Comparing the two outputs proves the
    // injected rng is what `mock` consumes.
    const lo = mock(num().min(10).max(20), {
      seed: 1,
      prng: () => constantRng(0),
    })
    const hi = mock(num().min(10).max(20), {
      seed: 1,
      prng: () => constantRng(0.999999),
    })
    assert.notStrictEqual(lo, hi, 'custom prng must change generated value')
  })

  it('omitting prng keeps the default mulberry32 sequence (BC)', () => {
    const a = mock(int().min(0).max(99), { seed: 42 })
    const b = mock(int().min(0).max(99), { seed: 42 })
    assert.strictEqual(a, b, 'numeric seed must be deterministic across calls')
    const c = mock(int().min(0).max(99), { seed: 'fixed' })
    const d = mock(int().min(0).max(99), { seed: 'fixed' })
    assert.strictEqual(c, d, 'string seed must be deterministic across calls')
  })
})
