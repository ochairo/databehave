/**
 * Extensibility surface — `walkSchema` and `fromIR`.
 *
 * Covers:
 *   - traversal order (pre-order + leave-callback post-order)
 *   - path encoding for objects, arrays, tuples, unions, discriminated
 *   - subtree pruning via `enter(): false`
 *   - `fromIR` round-trip across every IR kind, including discriminated
 *   - modifier preservation through round-trip
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import {
  arr,
  bool,
  decimal,
  discriminated,
  enum_,
  fromIR,
  int,
  literal,
  mock,
  null_,
  num,
  obj,
  parse,
  str,
  tuple,
  union,
  walkSchema,
  type SchemaNode,
  type WalkPath,
} from '../../src/index.js'

describe('walkSchema — traversal', () => {
  it('visits every node with paths in deterministic order', () => {
    const schema = obj({
      id: int(),
      tags: arr(str()).max(3),
      meta: obj({ owner: str() }),
    })
    const paths: string[] = []
    walkSchema(schema, {
      enter(_n, path) {
        paths.push(path.join('/'))
      },
    })
    assert.deepEqual(paths, ['', 'id', 'tags', 'tags/[]', 'meta', 'meta/owner'])
  })

  it('`enter` returning false skips the subtree', () => {
    const schema = obj({
      inner: obj({ deep: obj({ deeper: str() }) }),
      keep: int(),
    })
    const visited: string[] = []
    walkSchema(schema, {
      enter(_n, path) {
        visited.push(path.join('/'))
        if (path.join('/') === 'inner') return false
        return undefined
      },
    })
    assert.ok(visited.includes('inner'))
    assert.ok(!visited.includes('inner/deep'))
    assert.ok(visited.includes('keep'))
  })

  it('walks discriminated branches with positional `|i` tags', () => {
    const schema = discriminated('kind', {
      a: obj({ kind: literal('a'), x: int() }),
      b: obj({ kind: literal('b'), y: str() }),
    })
    const opts: string[] = []
    walkSchema(schema, {
      enter(_n, path: WalkPath) {
        opts.push(path.join('/'))
      },
    })
    assert.ok(opts.includes('|0'))
    assert.ok(opts.includes('|1'))
  })

  it('accepts a SchemaNode directly (not just a Schema)', () => {
    const node: SchemaNode = obj({ n: int() })._node
    let count = 0
    walkSchema(node, { enter: () => void count++ })
    assert.ok(count >= 2)
  })

  it('walks tuple positions with numeric indices', () => {
    const indices: (string | number)[] = []
    walkSchema(tuple(int(), str(), bool()), {
      enter(_n, path: WalkPath) {
        if (path.length === 1) indices.push(path[0]!)
      },
    })
    assert.deepEqual(indices, [0, 1, 2])
  })

  it('walks union options with `|0`, `|1`, … tags', () => {
    const tags: string[] = []
    walkSchema(union(int(), str(), bool()), {
      enter(_n, path: WalkPath) {
        if (path.length === 1) tags.push(String(path[0]))
      },
    })
    assert.deepEqual(tags, ['|0', '|1', '|2'])
  })

  it('does not descend into primitive leaves', () => {
    let count = 0
    walkSchema(int().min(0).max(10), { enter: () => void (count += 1) })
    assert.equal(count, 1)
  })

  it('fires `leave()` for every `enter()` (matched pre/post-order)', () => {
    const schema = obj({ a: int(), b: arr(str()) })
    const events: { phase: 'enter' | 'leave'; path: string }[] = []
    walkSchema(schema, {
      enter(_n, path) {
        events.push({ phase: 'enter', path: path.join('/') })
      },
      leave(_n, path) {
        events.push({ phase: 'leave', path: path.join('/') })
      },
    })
    const opened = new Set<string>()
    for (const ev of events) {
      if (ev.phase === 'enter') opened.add(ev.path)
      else assert.ok(opened.has(ev.path), `leave without enter for ${ev.path}`)
    }
  })
})

describe('fromIR — every kind round-trips', () => {
  const cases: { name: string; build: () => SchemaNode; sample: unknown }[] = [
    { name: 'string',  build: () => str()._node,                              sample: 'hello' },
    { name: 'number',  build: () => num().min(0).max(1)._node,                sample: 0.5 },
    { name: 'int',     build: () => int().min(0).max(10)._node,               sample: 5 },
    { name: 'decimal', build: () => decimal(10, 2).min('0').max('1')._node,   sample: '0.50' },
    { name: 'boolean', build: () => bool()._node,                             sample: true },
    { name: 'null',    build: () => null_()._node,                            sample: null },
    { name: 'literal', build: () => literal('x')._node,                       sample: 'x' },
    { name: 'enum',    build: () => enum_(['a', 'b'] as const)._node,         sample: 'a' },
    { name: 'tuple',   build: () => tuple(int(), str())._node,                sample: [1, 'a'] },
    { name: 'union',   build: () => union(int(), str())._node,                sample: 1 },
    { name: 'array',   build: () => arr(int()).length(3)._node,               sample: [1, 2, 3] },
    {
      name: 'array minLength/maxLength',
      build: () => arr(int()).min(2).max(4)._node,
      sample: [1, 2, 3],
    },
    {
      name: 'object',
      build: () => obj({ a: int(), b: str() })._node,
      sample: { a: 1, b: 'x' },
    },
    {
      name: 'discriminated',
      build: () =>
        discriminated('kind', {
          a: obj({ kind: literal('a'), x: int() }),
          b: obj({ kind: literal('b'), y: str() }),
        })._node,
      sample: { kind: 'a', x: 1 },
    },
  ]

  for (const c of cases) {
    it(`reconstructs ${c.name} and accepts the sample value`, () => {
      const rebuilt = fromIR(c.build())
      assert.doesNotThrow(() => parse(rebuilt, c.sample))
      assert.doesNotThrow(() => mock(rebuilt, { seed: c.name }))
    })
  }
})

describe('fromIR — modifier preservation', () => {
  it('preserves nullable + optional + describe', () => {
    const rebuilt = fromIR(str().nullable().optional().describe('a tag')._node)
    const mods = rebuilt._node.mods!
    assert.equal(mods.nullable, true)
    assert.equal(mods.optional, true)
    assert.equal(mods.description, 'a tag')
  })

  it('preserves default values', () => {
    const rebuilt = fromIR(int().default(7)._node)
    const mods = rebuilt._node.mods!
    assert.equal(mods.hasDefault, true)
    assert.equal(mods.defaultValue, 7)
  })

  it('preserves the `typically` distribution axis through round-trip', () => {
    const rebuilt = fromIR(int().min(0).max(100).typically(40, 60)._node)
    assert.equal(rebuilt._node.mods?.axes?.distribution?.kind, 'typical')
  })

  it('an IR-with-no-mods rebuild has no mods', () => {
    assert.equal(fromIR(int()._node)._node.mods, undefined)
  })

  it('round-trips a full nested object and re-validates generated values', () => {
    const original = obj({
      n: int().min(0).max(99),
      s: str().min(2).max(8),
      list: arr(str()).length(3),
    })
    const rebuilt = fromIR(original._node)
    for (let i = 0; i < 10; i += 1) {
      const v = mock(rebuilt, { seed: `r${i}` }) as { n: number; s: string; list: string[] }
      assert.ok(v.n >= 0 && v.n <= 99)
      assert.ok(v.s.length >= 2 && v.s.length <= 8)
      assert.equal(v.list.length, 3)
    }
  })
})
