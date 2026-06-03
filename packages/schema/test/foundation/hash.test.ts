/**
 * `identityKey` — deterministic dataset row identity.
 *
 * The hash module backs `mockDataset` row-uniqueness and is exposed
 * for plugins. The contract:
 *
 *   - keys are sorted alphabetically before joining
 *   - `undefined` and `null` are encoded as empty strings (distinct from
 *     "" only by *being missing* from `parts` in the first place)
 *   - all other primitives are stringified through `String(...)`
 *   - the full key shape is `METHOD|PATH|k1=v1&k2=v2&...`
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { identityKey } from '../../src/foundation/hash.js'

describe('identityKey', () => {
  it('joins method, path and sorted query parts deterministically', () => {
    const k = identityKey('GET', '/items', { item: 1, group: 'A' })
    assert.equal(k, 'GET|/items|group=A&item=1')
  })

  it('encodes undefined and null as empty strings', () => {
    const k = identityKey('GET', '/x', { b: 2, a: null, c: undefined })
    assert.equal(k, 'GET|/x|a=&b=2&c=')
  })

  it('preserves boolean and number primitives via String(...)', () => {
    const k = identityKey('POST', '/y', { flag: true, count: 7 })
    assert.equal(k, 'POST|/y|count=7&flag=true')
  })

  it('produces the same key regardless of insertion order', () => {
    const a = identityKey('GET', '/z', { x: 1, y: 2, z: 3 })
    const b = identityKey('GET', '/z', { z: 3, y: 2, x: 1 })
    assert.equal(a, b)
  })
})
