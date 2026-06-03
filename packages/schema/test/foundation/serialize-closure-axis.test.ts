/**
 * `serializeSchema` must reject schemas whose axes carry closures —
 * `derived`, `invariants`, `occasionally.value` — because closures
 * cannot survive a JSON round-trip. Failing loud at the encode site
 * prevents the receiving end from silently dropping the axis and
 * generating subtly wrong values.
 */
import { describe, it } from 'node:test'
import { strict as assert } from 'node:assert'

import { int, obj, str, union } from '../../src/index.js'
import { serializeSchema } from '../../src/internal.js'
import { SchemaConflictError } from '../../src/foundation/errors.js'

describe('serializeSchema — closure axis rejection', () => {
  it('rejects derivedFrom (function value)', () => {
    const schema = obj({
      a: int(),
      b: int().derivedFrom((ctx) => ((ctx.parent as { a: number }).a as number) + 1),
    })
    try {
      serializeSchema(schema)
      assert.fail('expected SchemaConflictError')
    } catch (err) {
      assert.ok(err instanceof SchemaConflictError, 'wrong error class')
      assert.strictEqual(err.code, 'serialize.closure-axis')
      assert.match(err.message, /derived/)
      assert.deepStrictEqual(err.path, ['b', 'axes', 'derived'])
    }
  })

  it('rejects invariant (function value)', () => {
    const schema = obj({
      n: int().invariant((v) => typeof v === 'number' && v > 0),
    })
    try {
      serializeSchema(schema)
      assert.fail('expected SchemaConflictError')
    } catch (err) {
      assert.ok(err instanceof SchemaConflictError, 'wrong error class')
      assert.strictEqual(err.code, 'serialize.closure-axis')
      assert.match(err.message, /invariants\[0\]/)
      assert.deepStrictEqual(err.path, ['n', 'axes', 'invariants', 0])
    }
  })

  it('rejects occasionally with a function value', () => {
    // `occasionally(value, p)` accepts any `T`; passing a function is
    // legal at the type level for `unknown`-typed call sites and is the
    // exact hazard this gate exists to surface.
    const schema = obj({
      tag: str().occasionally((() => 'never-jsonable') as unknown as string, 0.1),
    })
    try {
      serializeSchema(schema)
      assert.fail('expected SchemaConflictError')
    } catch (err) {
      assert.ok(err instanceof SchemaConflictError, 'wrong error class')
      assert.strictEqual(err.code, 'serialize.closure-axis')
      assert.match(err.message, /occasionally\[0\]\.value/)
      assert.deepStrictEqual(err.path, ['tag', 'axes', 'occasionally', 0, 'value'])
    }
  })

  it('walks into composites (array, object, tuple, union, discriminated)', () => {
    // Closure buried under a union branch must still be detected.
    const schema = obj({
      list: union(
        str(),
        int().derivedFrom(() => 0),
      ),
    })
    assert.throws(
      () => serializeSchema(schema),
      (err: unknown) =>
        err instanceof SchemaConflictError && err.code === 'serialize.closure-axis',
    )
  })

  it('passes through schemas with no closure axes', () => {
    const schema = obj({ id: int().min(0).max(99), name: str().min(1).max(10) })
    const env = serializeSchema(schema)
    assert.strictEqual(env.node.kind, 'object')
  })
})
