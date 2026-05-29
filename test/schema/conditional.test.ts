/**
 * `discriminated(...)` — schema builder semantics.
 *
 * Verifies:
 *   - build-time invariants (each branch must be `obj({...})` whose
 *     `key: literal(tag)` matches the map key)
 *   - the produced IR is a `DiscriminatedKind` (not a degraded union)
 *   - generation picks one branch and stamps the discriminator field
 *   - the discriminator key drives O(1) dispatch at validation time
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import {
  discriminated,
  int,
  literal,
  mock,
  obj,
  parse,
  safeParse,
  str,
} from '../../src/index.js'

describe('discriminated — build-time guards', () => {
  it('rejects an empty branch map', () => {
    assert.throws(
      () => discriminated('kind', {}),
      /at least one branch/,
    )
  })

  it('rejects a branch that is not an obj({...}) schema', () => {
    assert.throws(
      () => discriminated('kind', { a: int() as never }),
      /must be an obj\(/,
    )
  })

  it('rejects a branch missing the discriminator field', () => {
    assert.throws(
      () => discriminated('kind', { a: obj({ x: int() }) as never }),
      /missing the discriminator field "kind"/,
    )
  })

  it("rejects a branch whose discriminator field is not `literal(<tagKey>)`", () => {
    assert.throws(
      () =>
        discriminated('kind', {
          a: obj({ kind: literal('OTHER') }) as never,
        }),
      /must declare kind: literal\("a"\)/,
    )
  })
})

describe('discriminated — IR shape', () => {
  it('produces a `discriminated` IR node, not a `union`', () => {
    const Variant = discriminated('kind', {
      a: obj({ kind: literal('a'), x: int() }),
      b: obj({ kind: literal('b'), y: str() }),
    })
    const node = Variant._node as { kind: string; key: string; branches: Record<string, unknown> }
    assert.equal(node.kind, 'discriminated')
    assert.equal(node.key, 'kind')
    assert.deepEqual(Object.keys(node.branches), ['a', 'b'])
  })
})

describe('discriminated — generation', () => {
  const Variant = discriminated('kind', {
    digital: obj({ kind: literal('digital'), url: str() }),
    physical: obj({ kind: literal('physical'), kg: int().min(0).max(100) }),
  })

  it('every generated value carries the discriminator tag for its branch', () => {
    for (let i = 0; i < 30; i += 1) {
      const v = mock(Variant, { seed: `d-${i}` })
      if (v.kind === 'digital') {
        assert.equal(typeof v.url, 'string')
      } else {
        assert.equal(typeof v.kg, 'number')
      }
    }
  })
})

describe('discriminated — validation dispatch', () => {
  const Variant = discriminated('kind', {
    a: obj({ kind: literal('a'), x: int() }),
    b: obj({ kind: literal('b'), y: str() }),
  })

  it('routes a well-formed value to its branch', () => {
    assert.doesNotThrow(() => parse(Variant, { kind: 'a', x: 1 }))
    assert.doesNotThrow(() => parse(Variant, { kind: 'b', y: 'hi' }))
  })

  it('rejects a non-object value with a discriminated-union error', () => {
    for (const bad of ['oops', 42, []] as const) {
      const r = safeParse(Variant, bad)
      assert.equal(r.ok, false)
      if (r.ok === false) assert.match(r.error.message, /expected object \(discriminated union\)/)
    }
  })

  it('reports a missing discriminator with the key in the path', () => {
    const r = safeParse(Variant, { x: 1 })
    assert.equal(r.ok, false)
    if (r.ok === false) {
      const issue = r.error.issues.find((i) => i.path.includes('kind'))
      assert.ok(issue, 'expected an issue keyed on "kind"')
      assert.match(issue!.message, /missing discriminator/)
    }
  })

  it('reports an unknown tag value', () => {
    const r = safeParse(Variant, { kind: 'mystery' })
    assert.equal(r.ok, false)
    if (r.ok === false) {
      assert.match(r.error.message, /unknown discriminator value/)
    }
  })

  it('forwards branch errors with the discriminator already resolved', () => {
    const r = safeParse(Variant, { kind: 'a', x: 'not-a-number' })
    assert.equal(r.ok, false)
    if (r.ok === false) {
      const issue = r.error.issues.find((i) => i.path.includes('x'))
      assert.ok(issue, 'expected branch issue on "x"')
    }
  })
})
