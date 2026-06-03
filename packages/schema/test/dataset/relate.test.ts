/**
 * A1 — relate (cross-dataset FK).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  arr,
  int,
  mock,
  mockDataset,
  obj,
  relate,
  str,
} from '../../src/index.js'

describe('A1 — relate (cross-dataset FK)', () => {
  const Group = obj({
    group_code: str().min(2).max(4),
    region: str().min(2).max(4),
  })
  const groups = mockDataset({
    name: 'groups-rel',
    schema: Group,
    identity: ['group_code'],
    n: 5,
  })

  it('default random strategy is deterministic per seed', () => {
    const Item = obj({
      item_id: int(),
      group_code: str().derivedFrom(relate(groups, 'group_code')),
    })
    const a = mock(Item, { seed: 'fk1' })
    const b = mock(Item, { seed: 'fk1' })
    assert.equal(a.group_code, b.group_code)
    assert.ok(groups.some((row) => row.group_code === a.group_code))
  })

  it('different seeds pick different FKs (probabilistic, asserted via spread)', () => {
    const Item = obj({
      group_code: str().derivedFrom(relate(groups, 'group_code')),
    })
    const seen = new Set<string>()
    for (let i = 0; i < 30; i += 1) {
      seen.add(mock(Item, { seed: `fk-${i}` }).group_code)
    }
    assert.ok(seen.size >= 2, `expected >=2 distinct FKs across 30 seeds, got ${seen.size}`)
  })

  it('pickBy=index uses ctx.index modulo dataset length', () => {
    const Item = obj({
      group_code: str().derivedFrom(relate(groups, 'group_code', { pickBy: 'index' })),
    })
    for (let i = 0; i < groups.length * 2; i += 1) {
      const v = mock(Item, { seed: 'ix', index: i })
      assert.equal(v.group_code, groups[i % groups.length]!.group_code)
    }
  })

  it('pickBy callback receives the GenContext', () => {
    const Item = obj({
      group_code: str().derivedFrom(
        relate(groups, 'group_code', { pickBy: (ctx) => ctx.index ?? 0 }),
      ),
    })
    const v = mock(Item, { seed: 'cb', index: 2 })
    assert.equal(v.group_code, groups[2]!.group_code)
  })

  it('throws on empty dataset', () => {
    assert.throws(() => relate([], 'x'), /empty dataset/)
  })

  it('works inside arr() with per-row identity', () => {
    const Cat = obj({
      items: arr(
        obj({
          item_id: int(),
          group_code: str().derivedFrom(relate(groups, 'group_code', { pickBy: 'index' })),
        }),
      ).length(5),
    })
    const out = mock(Cat, { seed: 'arr' })
    out.items.forEach((t, i) => {
      assert.equal(t.group_code, groups[i % groups.length]!.group_code)
    })
  })
})

describe('relate — pickBy edge cases', () => {
  it('throws a RangeError when the source dataset is empty', () => {
    assert.throws(
      () => relate([] as Array<{ x: number }>, 'x'),
      /empty dataset/,
    )
  })

  it('a negative pickBy result wraps to a valid row (last element)', () => {
    const rows: Array<{ code: string }> = [{ code: 'a' }, { code: 'b' }, { code: 'c' }]
    const Item = obj({
      code: str().derivedFrom(relate(rows, 'code', { pickBy: () => -1 })),
    })
    for (let i = 0; i < 10; i += 1) {
      const v = mock(Item, { seed: `neg-${i}` })
      assert.equal(v.code, 'c')
    }
  })
})
