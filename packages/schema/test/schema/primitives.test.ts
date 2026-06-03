/**
 * Primitive builders — `str`, `num`, `int`, `bool`, `null_`.
 *
 * Each test pins down two contracts:
 *   - the produced IR (`_node`) shape
 *   - immutability of the fluent chain (each `.min()/.max()/.pattern()` call
 *     returns a *new* builder so previously-captured references stay stable)
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { bool, int, null_, num, str } from '../../src/schema/primitives.js'

describe('str()', () => {
  it('produces a `string` kind with `format: "plain"` by default', () => {
    assert.deepEqual(str()._node, { kind: 'string', format: 'plain' })
  })

  it('.min/.max/.pattern return new builders without mutating the original', () => {
    const a = str()
    const b = a.min(2).max(10).pattern('^[a-z]+$')
    assert.notEqual(a, b)
    assert.deepEqual(a._node, { kind: 'string', format: 'plain' })
    assert.equal(b._node.min, 2)
    assert.equal(b._node.max, 10)
    assert.equal(b._node.pattern, '^[a-z]+$')
  })

  it('.pattern accepts a RegExp and stores its `.source`', () => {
    const s = str().pattern(/^\d+$/)
    assert.equal(s._node.pattern, '^\\d+$')
  })

  it('generated samples satisfy the declared `.pattern` (round-trip)', async () => {
    // Regression guard: `genString` used to ignore `pattern` entirely, so a
    // value built with `mock(s)` could be rejected by `parse(s, …)` on the
    // *same* schema. We now reject-sample until a match is found.
    const { mock } = await import('../../src/generator/engine.js')
    const { parse } = await import('../../src/validator/parse.js')
    const s = str().min(3).max(8).pattern(/^[a-z0-9_-]+$/)
    for (let seed = 0; seed < 20; seed += 1) {
      const value = mock(s, { seed: `pattern-${seed}` })
      assert.equal(parse(s, value), value)
    }
  })
})

describe('num() / int()', () => {
  it('`num()` produces `{ kind: "number", int: false }`', () => {
    assert.deepEqual(num()._node, { kind: 'number', int: false })
  })

  it('`int()` produces `{ kind: "number", int: true }`', () => {
    assert.deepEqual(int()._node, { kind: 'number', int: true })
  })

  it('.min/.max return new builders with the bound set', () => {
    const a = num()
    const b = a.min(0).max(100)
    assert.notEqual(a, b)
    assert.equal(b._node.min, 0)
    assert.equal(b._node.max, 100)
    assert.equal(a._node.min, undefined)
  })
})

describe('bool() / null_()', () => {
  it('`bool()` produces `{ kind: "boolean" }`', () => {
    assert.deepEqual(bool()._node, { kind: 'boolean' })
  })

  it('`null_()` produces `{ kind: "null" }`', () => {
    assert.deepEqual(null_()._node, { kind: 'null' })
  })
})
