/**
 * Phase 10 — IR versioning regression.
 *
 * Pairs with `serializeSchema` / `deserializeSchema` in `internal.ts`.
 * These tests pin the envelope shape and the version-mismatch
 * behaviour. Bumping `IR_VERSION` (a MAJOR-only change per
 * `docs/STABILITY.md`) requires updating the expected value here and
 * documenting the IR diff in CHANGELOG.md.
 */
import { describe, it } from 'node:test'
import { strict as assert } from 'node:assert'

import { int, mock, obj, str } from '../../src/index.js'
import {
  IR_VERSION,
  deserializeSchema,
  serializeSchema,
} from '../../src/internal.js'

describe('IR versioning — envelope round-trip', () => {
  it('serialised envelope carries $databehaveVersion', () => {
    const schema = obj({ id: int(), name: str().min(1).max(10) })
    const env = serializeSchema(schema)
    assert.strictEqual(env.$databehaveVersion, IR_VERSION)
    assert.strictEqual(env.node.kind, 'object')
  })

  it('deserialize → mock yields a value matching the original schema', () => {
    const schema = obj({ n: int().min(0).max(99) })
    const env = serializeSchema(schema)
    const restored = deserializeSchema(env)
    const value = mock(restored as typeof schema, { seed: 'ir-roundtrip' })
    assert.ok(typeof (value as { n: number }).n === 'number')
    assert.ok((value as { n: number }).n >= 0 && (value as { n: number }).n <= 99)
  })

  it('JSON round-trip preserves IR fidelity', () => {
    const schema = obj({ s: str().min(2).max(5) })
    const json = JSON.stringify(serializeSchema(schema))
    const restored = deserializeSchema(JSON.parse(json))
    // Same seed → same output across the serialisation boundary.
    const a = mock(schema, { seed: 'json-1' })
    const b = mock(restored as typeof schema, { seed: 'json-1' })
    assert.deepStrictEqual(a, b)
  })
})

describe('IR versioning — incompatibility is loud', () => {
  it('rejects envelopes with a different version', () => {
    const env = { $databehaveVersion: 999, node: { kind: 'string' as const } }
    assert.throws(
      () => deserializeSchema(env),
      /incompatible IR version/,
      'older/newer envelopes must throw, not silently load',
    )
  })

  it('rejects non-object envelopes', () => {
    assert.throws(() => deserializeSchema(null), /expected an envelope object/)
    assert.throws(() => deserializeSchema('"oops"'), /expected an envelope object/)
  })

  it('rejects envelopes missing a node', () => {
    assert.throws(
      () => deserializeSchema({ $databehaveVersion: IR_VERSION }),
      /envelope\.node must be an IR object/,
    )
  })
})
