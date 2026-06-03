/**
 * F4 — runtime fail-loud guard on axis builders.
 *
 * The type system blocks `.weighted` / `.normal` / `.typically` on
 * schema kinds where the operation is incoherent (`obj`, `arr`,
 * `union`, `int().normal`, `num().weighted`, …). But callers using
 * `// @ts-ignore`, plain JS, or an `as any` cast bypass that block —
 * silently mutating `axes.distribution` would surface much later as a
 * subtle generation/parse bug far from the cause.
 *
 * The runtime guard mirrors the type-system gating exactly. These
 * tests pin both that the throw fires AND that legitimate callers
 * (covered by the positive matrix in `axes-narrowing.test-d.ts`)
 * stay green.
 *
 * See `docs/stability.md` "fail-loud" promise.
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { SchemaConflictError } from '../../src/foundation/errors.js'
import {
  arr,
  bool,
  decimal,
  enum_,
  int,
  literal,
  null_,
  num,
  obj,
  str,
  tuple,
  union,
} from '../../src/index.js'

// `as any` is the supported escape hatch for asserting runtime guards
// fire even when TypeScript would have blocked the call. This mirrors
// what plain-JS or `// @ts-ignore` callers can produce in practice.
type Anyish = {
  weighted: (w: ReadonlyArray<readonly [unknown, number]>) => unknown
  normal: (mean: number, stddev: number) => unknown
  typically: (from: number, to: number) => unknown
}

const asAny = <S>(s: S): Anyish => s as unknown as Anyish

describe('axis fail-loud — composites (F4)', () => {
  it('obj({...}).weighted(...) throws SchemaConflictError', () => {
    assert.throws(
      () => asAny(obj({ a: str() })).weighted([[{ a: 'x' }, 1]]),
      SchemaConflictError,
    )
  })

  it('obj({...}).normal(...) throws SchemaConflictError', () => {
    assert.throws(() => asAny(obj({ a: str() })).normal(0, 1), SchemaConflictError)
  })

  it('obj({...}).typically(...) throws SchemaConflictError', () => {
    assert.throws(() => asAny(obj({ a: str() })).typically(1, 5), SchemaConflictError)
  })

  it('arr(str()).weighted/normal/typically throw', () => {
    assert.throws(() => asAny(arr(str())).weighted([['a', 1]]), SchemaConflictError)
    assert.throws(() => asAny(arr(str())).normal(0, 1), SchemaConflictError)
    assert.throws(() => asAny(arr(str())).typically(1, 5), SchemaConflictError)
  })

  it('tuple(...).weighted/normal/typically throw', () => {
    assert.throws(() => asAny(tuple(str(), int())).weighted([]), SchemaConflictError)
    assert.throws(() => asAny(tuple(str(), int())).normal(0, 1), SchemaConflictError)
    assert.throws(() => asAny(tuple(str(), int())).typically(1, 5), SchemaConflictError)
  })

  it('union(...).weighted/normal/typically throw', () => {
    assert.throws(() => asAny(union(str(), int())).weighted([['x', 1]]), SchemaConflictError)
    assert.throws(() => asAny(union(num(), decimal(10, 2))).normal(0, 1), SchemaConflictError)
    assert.throws(() => asAny(union(num(), decimal(10, 2))).typically(0, 100), SchemaConflictError)
  })
})

describe('axis fail-loud — number/int split (F1 mirror)', () => {
  it('num().weighted(...) throws (continuous; no discrete weighting)', () => {
    assert.throws(
      () => asAny(num()).weighted([[1.5, 0.5]]),
      (err: unknown) =>
        err instanceof SchemaConflictError &&
        /num\(\) \(continuous\)/.test((err as Error).message),
    )
  })

  it('int().normal(...) throws (Gaussian on int loses σ to rounding)', () => {
    assert.throws(
      () => asAny(int()).normal(0, 1),
      (err: unknown) =>
        err instanceof SchemaConflictError && /int\(\) \(discrete\)/.test((err as Error).message),
    )
  })

  it('int().typically(...) is allowed (clamps + rounds)', () => {
    // Positive case — must NOT throw.
    asAny(int()).typically(1, 5)
  })
})

describe('axis fail-loud — null is fully off-axis', () => {
  it('null_() rejects all three axis builders', () => {
    const n = null_()
    assert.throws(() => asAny(n).weighted([[null, 1]]), SchemaConflictError)
    assert.throws(() => asAny(n).normal(0, 1), SchemaConflictError)
    assert.throws(() => asAny(n).typically(1, 5), SchemaConflictError)
  })
})

describe('axis fail-loud — positive cases stay green', () => {
  it('legitimate axis builders do not throw', () => {
    num().normal(0, 1)
    num().typically(1, 5)
    int().weighted([[1, 0.5], [2, 0.5]])
    int().typically(1, 5)
    decimal(10, 4).normal(0, 1)
    decimal(10, 4).typically(0, 100)
    str().weighted([['a', 1]])
    enum_(['a', 'b']).weighted([['a', 1], ['b', 1]])
    literal('x').weighted([['x', 1]])
    bool().weighted([[true, 0.7], [false, 0.3]])
  })
})
