import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { identityFor, mockDataset } from '../../src/dataset/dataset.js'
import { obj } from '../../src/schema/composites.js'
import { decimal } from '../../src/schema/decimal.js'
import { int, str } from '../../src/schema/primitives.js'

describe('mockDataset — basics', () => {
  it('generates the requested number of records', () => {
    const Row = obj({
      group: str().in(['A', 'B']),
      item: int().min(1).max(99),
      quantity: decimal(38, 19).min('0').max('1000'),
    })
    const rows = mockDataset({
      name: 'cat',
      schema: Row,
      identity: ['group', 'item'],
      n: 20,
    })
    assert.equal(rows.length, 20)
  })

  it('aggregate invariant is satisfied or throws', () => {
    const Row = obj({ x: int().min(0).max(10) })
    const rows = mockDataset({
      name: 'agg',
      schema: Row,
      identity: ['x'],
      n: 5,
      invariants: [(rs) => rs.length === 5],
    })
    assert.equal(rows.length, 5)
  })

  it('identical inputs produce identical outputs (determinism)', () => {
    const Row = obj({ a: int().min(0).max(100), b: str() })
    const opts = {
      name: 'det',
      schema: Row,
      identity: ['a'],
      n: 10,
    } as const
    const r1 = mockDataset(opts)
    const r2 = mockDataset(opts)
    assert.deepEqual(r1, r2)
  })

  it('rows with unique identity yield distinct values (per-row seed propagates)', () => {
    const Row = obj({
      idx: int().min(0).max(10_000).derivedFrom((c) => c.index ?? -1),
      cap: int().min(1_000).max(99_000),
    })
    const rows = mockDataset({
      name: 'distinct',
      schema: Row,
      identity: ['idx'],
      n: 5,
      seedPrefix: 'distinct-seed',
    })
    // Each row gets a unique idx from ctx.index → identity is unique → no dedup.
    const idxs = rows.map((r) => (r as { idx: number }).idx)
    assert.deepEqual(idxs, [0, 1, 2, 3, 4])
    // And `cap` should vary across rows (extremely unlikely to all collide).
    const caps = new Set(rows.map((r) => (r as { cap: number }).cap))
    assert.ok(caps.size >= 4, `expected at least 4 distinct cap values, got ${caps.size}`)
  })

  it('opts.input is exposed to derived as ctx.input', () => {
    const Row = obj({
      group: str().derivedFrom((c) => String((c.input ?? {})['group'] ?? 'UNKNOWN')),
      item: int().min(1).max(10).derivedFrom((c) => (c.index ?? 0) + 1),
    })
    const rows = mockDataset({
      name: 'with-input',
      schema: Row,
      identity: ['group', 'item'],
      n: 3,
      input: { group: 'A' },
    })
    assert.deepEqual(rows, [
      { group: 'A', item: 1 },
      { group: 'A', item: 2 },
      { group: 'A', item: 3 },
    ])
  })
})

describe('identityFor', () => {
  it('same identity fields → same key', () => {
    const a = identityFor('cat', ['group', 'item'], { group: 'A', item: 1, other: 'X' })
    const b = identityFor('cat', ['group', 'item'], { group: 'A', item: 1, other: 'Y' })
    assert.equal(a, b)
  })

  it('different identity fields → different key', () => {
    const a = identityFor('cat', ['group', 'item'], { group: 'A', item: 1 })
    const b = identityFor('cat', ['group', 'item'], { group: 'A', item: 2 })
    assert.notEqual(a, b)
  })

  it('different dataset names → different key', () => {
    const a = identityFor('cat', ['x'], { x: 1 })
    const b = identityFor('other', ['x'], { x: 1 })
    assert.notEqual(a, b)
  })
})

describe('mockDataset — identity uniqueness', () => {
  it('re-samples on identity collision and yields all-distinct keys', () => {
    // id ∈ {0..9}, request 8 distinct — engine must dedupe.
    const Row = obj({ id: int().min(0).max(9), v: str() })
    const rows = mockDataset({ name: 'u', schema: Row, identity: ['id'], n: 8 })
    const ids = rows.map((r) => r.id)
    assert.equal(new Set(ids).size, 8, `dupes: ${ids.join(',')}`)
  })

  it('throws when the identity domain is too narrow to satisfy n', () => {
    // id ∈ {0..1} ⇒ only 2 distinct rows possible; asking for 50 must throw.
    const Row = obj({ id: int().min(0).max(1) })
    assert.throws(
      () => mockDataset({ name: 'narrow', schema: Row, identity: ['id'], n: 50 }),
      /identity uniqueness/,
    )
  })

  it('identityFor sorts parts alphabetically (key stability under reordering)', () => {
    const Row = obj({ b: int(), a: int() })
    // Two rows with the same values must produce the same key regardless of
    // the field order in `identity`.
    const k1 = identityFor('d', ['a', 'b'], { a: 1, b: 2 } as unknown as Record<string, unknown>)
    const k2 = identityFor('d', ['b', 'a'], { a: 1, b: 2 } as unknown as Record<string, unknown>)
    assert.equal(k1, k2)
    void Row
  })
})

describe('mockDataset — coverage edges', () => {
  it('honors `seedPrefix` (different from `name`) for row-seed derivation', () => {
    const Row = obj({ id: int().min(0).max(99) })
    const a = mockDataset({ name: 'D', seedPrefix: 'P1', schema: Row, identity: ['id'], n: 3 })
    const b = mockDataset({ name: 'D', seedPrefix: 'P2', schema: Row, identity: ['id'], n: 3 })
    assert.notDeepEqual(a, b, 'seedPrefix must affect generation')
  })

  it('passes `input` through to the row generator (ctx.input)', () => {
    const Row = obj({
      tag: int().derivedFrom((ctx) => (ctx.input?.['tag'] as number) ?? -1),
    })
    const rows = mockDataset({
      name: 'I',
      schema: Row,
      identity: ['tag'],
      n: 1,
      input: { tag: 42 },
    })
    assert.equal(rows[0]?.tag, 42)
  })

  it('throws SchemaConflictError when aggregate invariants never hold', () => {
    const Row = obj({ x: int().min(0).max(100) })
    assert.throws(
      () =>
        mockDataset({
          name: 'agg-fail',
          schema: Row,
          identity: ['x'],
          n: 3,
          invariants: [() => false], // impossible
        }),
      /aggregate invariants/,
    )
  })
})

describe('identityFor — null vs undefined sentinels', () => {
  it('encodes explicit `null` and `undefined` distinctly', () => {
    const a = identityFor('d', ['v'], { v: null })
    const b = identityFor('d', ['v'], { v: undefined })
    const c = identityFor('d', ['v'], { v: 'x' })
    assert.notEqual(a, b)
    assert.notEqual(a, c)
    assert.notEqual(b, c)
  })

  it('JSON-stringifies non-null values (so 1 vs "1" are distinct)', () => {
    const numKey = identityFor('d', ['v'], { v: 1 })
    const strKey = identityFor('d', ['v'], { v: '1' })
    assert.notEqual(numKey, strKey)
  })
})
