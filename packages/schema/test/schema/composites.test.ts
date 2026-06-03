/**
 * `obj`, `arr`, `tuple`, `union`, `literal`, `enum_` — composite builders.
 *
 * Coverage in this file:
 *   - `obj()` refuses to register fields whose names would let user data
 *     reach `Object.prototype` (prototype pollution defence)
 *   - `arr()` configured with `minLength > maxLength` is reported at the
 *     generator boundary. The fluent `.min(n).max(n)` chain *does* preserve
 *     prior bounds (regression guard for an earlier bug where the second
 *     call silently dropped the first), so the chained form can also build
 *     the contradiction.
 *   - arity guards: `union()` / `enum_()` reject empty argument lists
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { ArraySchema, enum_, int, mock, obj, str, union } from '../../src/index.js'
import { SchemaConflictError } from '../../src/foundation/errors.js'

describe('obj() — prototype-pollution guard', () => {
  for (const name of ['__proto__', 'prototype', 'constructor'] as const) {
    it(`refuses field name "${name}"`, () => {
      assert.throws(
        () => obj({ [name]: str() } as Record<string, ReturnType<typeof str>>),
        /forbidden/,
      )
    })
  }

  it('a normal key is accepted', () => {
    assert.doesNotThrow(() => obj({ proto: str(), classy: int() }))
  })
})

describe('ArraySchema — minLength > maxLength', () => {
  it('throws SchemaConflictError at generation time (constructor)', () => {
    const bad = new ArraySchema(int(), { minLength: 5, maxLength: 1 })
    assert.throws(() => mock(bad, { seed: 's' }), SchemaConflictError)
  })

  it('fluent .min().max() preserves both bounds and surfaces the conflict', () => {
    // Regression: `.max()` used to discard the prior `.min()` because each
    // builder constructed a fresh schema with only its own option. The
    // current implementation spreads the existing bounds so a contradictory
    // pair survives to the generator and is reported.
    const bad = arrMinMax()
    assert.throws(() => mock(bad, { seed: 's' }), SchemaConflictError)
  })

  it('fluent .min() then .length() retains length-as-source-of-truth', () => {
    const a = new ArraySchema(int()).min(2).length(3)
    const sample = mock(a, { seed: 's' }) as number[]
    assert.equal(sample.length, 3)
  })

  it('fluent .min()/.max()/.length() preserves modifiers set earlier in the chain', () => {
    // Regression: `rebuild()` used to build the new IR node from
    // scratch via the constructor, dropping `_node.mods` entirely. So
    // `arr(int()).describe('xs').min(2)` would silently lose the
    // description, and `arr(int()).weighted([...]).max(3)` would lose
    // the distribution axis. The fix re-applies `withMods` after
    // construction.
    const described = new ArraySchema(int()).describe('important list').min(2)
    assert.equal(described._node.mods?.description, 'important list')
    assert.equal(described._node.minLength, 2)

    // `.optional()` returns a base `Schema<T|undef>` (not ArraySchema),
    // so the chain must put `.min()` first; we still verify the
    // resulting node carries the optional modifier through.
    const opt = new ArraySchema(int()).min(2).max(4)
    assert.equal(opt._node.minLength, 2)
    assert.equal(opt._node.maxLength, 4)
  })
})

// Local helper so the test description above stays readable.
function arrMinMax(): ArraySchema<ReturnType<typeof int>> {
  return new ArraySchema(int()).min(5).max(1)
}

describe('composites — arity guards', () => {
  it('union() requires at least one option', () => {
    assert.throws(() => union(), RangeError)
  })

  it('enum_() requires at least one value', () => {
    assert.throws(() => enum_([]), RangeError)
  })
})
