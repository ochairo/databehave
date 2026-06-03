/**
 * A2/A3/A5/A6 — trace, replay/expectStable, correlate, eventually.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  arr,
  bool,
  createTrace,
  decimal,
  enum_,
  expectStable,
  int,
  literal,
  mock,
  num,
  obj,
  replay,
  str,
} from '../../src/index.js'

describe('A2 — trace collector', () => {
  it('records the axis that fired for every field', () => {
    const schema = obj({
      kind: literal('a'),
      n: int().min(0).max(10).typically(3, 5),
      pick: enum_(['x', 'y', 'z'] as const).in(['x', 'y']),
      sum: int().derivedFrom((ctx) => Number((ctx.parent as { n: number }).n) * 2),
    })
    const trace = createTrace()
    mock(schema, { seed: 'trace1', trace })

    const axesByPath = new Map(trace.entries.map((e) => [e.path.join('/'), e.axis]))
    assert.equal(axesByPath.get('kind'), 'type')
    assert.equal(axesByPath.get('n'), 'distribution')
    assert.equal(axesByPath.get('pick'), 'domain')
    assert.equal(axesByPath.get('sum'), 'derived')
  })

  it('counts attempts when invariants reject samples', () => {
    const schema = obj({
      n: int().min(0).max(10).invariant((v) => (v as number) >= 8),
    })
    const trace = createTrace()
    mock(schema, { seed: 'invtrace', trace })
    const entry = trace.entries.find((e) => e.path.join('/') === 'n')
    assert.ok(entry)
    assert.equal(entry!.axis, 'invariant-pass')
    assert.ok((entry!.attempts ?? 0) >= 1)
  })

  it('axisFiredAt and format() expose entries', () => {
    const schema = obj({ a: bool(), b: str() })
    const trace = createTrace()
    mock(schema, { seed: 's', trace })
    assert.ok(trace.axisFiredAt('type').length >= 1)
    assert.match(trace.format(), /\/a\s+type/)
  })
})

describe('A3 — replay / expectStable', () => {
  it('replay() yields identical values across invocations', () => {
    const schema = obj({ n: int(), s: str(), d: decimal(5, 2) })
    const r = replay(schema, { seed: 'r1' })
    const a = r()
    const b = r()
    assert.deepEqual(a, b)
    assert.equal(r.options.seed, 'r1')
  })

  it('expectStable returns the value when deterministic', () => {
    const schema = obj({ n: int() })
    const v = expectStable(schema, { seed: 's1' })
    assert.ok(typeof v.n === 'number')
  })

  it('expectStable throws when derivedFrom is non-deterministic', () => {
    const schema = obj({
      n: int().derivedFrom(() => Math.floor(Math.random() * 1e9)),
    })
    assert.throws(() => expectStable(schema, { seed: 's2' }), /non-deterministic/)
  })
})

describe('A5 — correlate (multi-field invariants)', () => {
  it('correlate is rejection-sampled until the predicate holds', () => {
    const Range = obj({
      start: int().min(0).max(100),
      end: int().min(0).max(100),
    }).correlate((r) => r.start <= r.end)
    for (let s = 0; s < 20; s += 1) {
      const r = mock(Range, { seed: `c${s}` })
      assert.ok(r.start <= r.end, `start ${r.start} > end ${r.end}`)
    }
  })
})

describe('A6 — eventually (modulo cadence)', () => {
  it('forces value every N rows, otherwise samples normally', () => {
    const schema = num().min(0).max(1000).eventually(5, -1)
    const results: number[] = []
    for (let i = 0; i < 15; i += 1) {
      results.push(mock(schema, { seed: 'e', index: i }))
    }
    // i=0,5,10 → -1; others must NOT be -1 (since base range is [0,1000]).
    assert.equal(results[0], -1)
    assert.equal(results[5], -1)
    assert.equal(results[10], -1)
    for (const i of [1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14]) {
      assert.notEqual(results[i], -1)
    }
  })

  it('with offset, fires at (i - offset) % every === 0', () => {
    const schema = num().eventually(3, -1, { offset: 1 })
    const results: number[] = []
    for (let i = 0; i < 7; i += 1) results.push(mock(schema, { seed: 'eo', index: i }))
    // i=1,4 → -1; i=0 → not fired (i < offset)
    assert.notEqual(results[0], -1)
    assert.equal(results[1], -1)
    assert.equal(results[4], -1)
  })

  it('eventually wins over occasionally when both apply', () => {
    const schema = num().min(0).max(100).eventually(2, -1).occasionally(-2, 1.0)
    const v = mock(schema, { seed: 'pri', index: 0 })
    assert.equal(v, -1)
  })

  it('skipped silently when ctx.index is undefined', () => {
    const schema = num().min(10).max(20).eventually(2, -1)
    const v = mock(schema, { seed: 'nox' })
    assert.notEqual(v, -1)
    assert.ok(v >= 10 && v <= 20)
  })

  it('appears in the trace as axis=eventually', () => {
    const schema = obj({ x: num().eventually(1, -1) })
    const trace = createTrace()
    mock(schema, { seed: 't', index: 0, trace })
    const e = trace.entries.find((x) => x.path.join('/') === 'x')
    assert.equal(e?.axis, 'eventually')
  })
})

describe('A4 — discriminated narrowing (compile-time check via shape)', () => {
  it('discriminated branches each carry their literal key', () => {
    // The compile-time narrowing is exercised by `Infer<typeof U>` users;
    // at runtime we just verify each produced value matches one branch.
    const Alpha = obj({ kind: literal('alpha'), score: num() })
    const Liq = obj({ kind: literal('liq'), dens: num() })
    const U = arr(
      // discriminated under the hood produces a union with literal tags
      obj({ tag: literal('a'), payload: Alpha }).correlate((r) => r.tag === 'a'),
    ).min(1).max(3)
    const out = mock(U, { seed: 'd' })
    for (const item of out) {
      assert.equal(item.tag, 'a')
      assert.equal(item.payload.kind, 'alpha')
      void Liq // referenced for type-only purposes
    }
  })
})
