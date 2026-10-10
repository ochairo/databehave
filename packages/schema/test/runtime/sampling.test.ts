import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  createSchemaRuntime, createTrace, defineBehavior, enum_, int, literal, obj, str,
  standardBehaviors, standardKinds,
  type BehaviorDefinition, type GenerationContext, type SamplingContext,
} from '../../src/index.js'

const middleware = (id: string, generate: BehaviorDefinition<true>['generate']) => defineBehavior<true>({
  id, version: 1, phase: 'sample',
  checkMetadata: (value) => { if (value !== true) throw new TypeError('expected true'); return value },
  appliesTo: () => true,
  merge: (_previous, next) => next,
  generate,
  validate: (_metadata, _node, _value, _context, next) => next(),
  serialize: (value) => value,
})
const scope = (value: string): SamplingContext => ({ candidates: [value], fallback: () => value })

describe('scoped sampling continuations', () => {
  it('scopes nested and repeated next overrides and starts child generation without sampling', () => {
    const seen: (SamplingContext | undefined)[] = []
    const childScopes: (SamplingContext | undefined)[] = []
    const outerScope = scope('outer')
    const innerScope = scope('inner')
    const outer = middleware('outer', (_metadata, _node, context, next) => {
      assert.equal(context.sampling, undefined)
      const result = [next(outerScope), next()]
      assert.equal(context.sampling, undefined)
      return result
    })
    const inner = middleware('inner', (_metadata, _node, context, next) => {
      const original = context.sampling
      const result = [next(innerScope), next()]
      assert.equal(context.sampling, original)
      return result
    })
    const observer = middleware('observer', (_metadata, _node, context, next) => {
      seen.push(context.sampling)
      assert.equal(context.generate(literal('child')._node, [...context.path, 'child'], context.parent), 'child')
      return next()
    })
    const runtime = createSchemaRuntime({
      kinds: standardKinds.map((kind) => kind.id === 'literal' ? {
        ...kind,
        generate: (node, context) => { childScopes.push(context.sampling); return kind.generate(node, context) },
      } : kind),
      behaviors: [...standardBehaviors, outer, inner, observer],
    })
    const schema = outer.apply(inner.apply(observer.apply(int().min(9).max(9), true), true), true)
    assert.deepEqual(runtime.mock(schema), [['inner', 'outer'], ['inner', 9]])
    assert.deepEqual(seen, [innerScope, outerScope, innerScope, undefined])
    assert.deepEqual(childScopes, [undefined, undefined, undefined, undefined])
  })

  it('invokes a replacement distribution for values and lookup domains with its own metadata', () => {
    const candidates: (readonly unknown[])[] = []
    const replacement = defineBehavior<number>({
      id: 'distribution', version: 1, phase: 'sample',
      checkMetadata: (value) => { if (typeof value !== 'number') throw new TypeError('expected index'); return value },
      appliesTo: () => true,
      merge: (_previous, next) => next,
      generate: (index, _node, context, next) => {
        if (context.sampling === undefined) return next()
        candidates.push(context.sampling.candidates)
        return context.sampling.candidates[index]
      },
      validate: (_metadata, _node, _value, _context, next) => next(),
      serialize: (value) => value,
    })
    const runtime = createSchemaRuntime({
      kinds: standardKinds,
      behaviors: standardBehaviors.map((behavior) => behavior.id === 'distribution' ? replacement : behavior),
    })
    const schema = obj({
      key: literal('a'),
      direct: replacement.apply(int().in([11, 22]), 1),
      lookup: replacement.apply(int().in({ kind: 'lookup', fromField: 'key', map: { a: [33, 44] } }), 0),
    })
    assert.deepEqual(runtime.mock(schema), { key: 'a', direct: 22, lookup: 33 })
    assert.deepEqual(candidates, [[11, 22], [33, 44]])
  })

  it('retains sample-phase composition order instead of moving distribution ahead of or behind domain', () => {
    const seen: (SamplingContext | undefined)[] = []
    const distribution = middleware('distribution', (_metadata, _node, context, next) => {
      seen.push(context.sampling)
      return next()
    })
    const domain = standardBehaviors.find((behavior) => behavior.id === 'domain')
    assert.ok(domain)
    const schema = distribution.apply(int().in([42]), true)
    for (const behaviors of [[distribution, domain], [domain, distribution]]) {
      const runtime = createSchemaRuntime({ kinds: standardKinds, behaviors })
      assert.equal(runtime.mock(schema), 42)
    }
    assert.equal(seen[0], undefined)
    assert.deepEqual(seen[1]?.candidates, [42])
  })

  it('delegates empty or missing domains and uniform fallback to the appropriate sampler', () => {
    const runtime = createSchemaRuntime({ kinds: standardKinds, behaviors: standardBehaviors })
    assert.equal(runtime.mock(enum_([42, 99]).in([]).weighted([[99, 1]])), 99)
    assert.equal(runtime.mock(enum_([42, 99]).in({ kind: 'lookup', fromField: 'absent', map: {} }).weighted([[99, 1]])), 99)
    assert.equal(runtime.mock(int().in([42]).weighted([[99, 1]])), 42)
    assert.equal(runtime.mock(int().in([42]).weighted([[42, 0]])), 42)
    assert.equal(runtime.mock(literal(null).in([null])), null)
  })

  it('preserves pre-change seeded domain fixtures, traces and replay', () => {
    const runtime = createSchemaRuntime({ kinds: standardKinds, behaviors: standardBehaviors })
    const schema = obj({
      tag: str().in(['a']),
      plain: int().in([2, 4, 8]),
      weighted: int().in([2, 4, 8]).weighted([[2, 1], [8, 3], [99, 100]]),
      zero: int().in([2, 4, 8]).weighted([[2, 0]]),
      lookup: int().in({ kind: 'lookup', fromField: 'tag', map: { a: [3, 5, 7] } }),
    })
    const fixtures = [
      { seed: 'scope-1', expected: { tag: 'a', plain: 8, weighted: 8, zero: 8, lookup: 7 } },
      { seed: 'scope-2', expected: { tag: 'a', plain: 8, weighted: 2, zero: 4, lookup: 5 } },
      { seed: 7, expected: { tag: 'a', plain: 2, weighted: 8, zero: 8, lookup: 5 } },
    ]
    for (const { seed, expected } of fixtures) {
      const trace = createTrace()
      assert.deepEqual(runtime.mock(schema, { seed, trace }), expected)
      assert.deepEqual(runtime.replay(schema, { seed })(), expected)
      assert.deepEqual(trace.entries.map(({ path, axis }) => ({ path, axis })), [
        ...['tag', 'plain', 'weighted', 'zero', 'lookup'].map((key) => ({ path: [key], axis: 'domain' })),
        { path: [], axis: 'type' },
      ])
      assert.deepEqual(trace.entries[2]?.contracts?.behaviors, [
        { id: 'modifiers', version: 1 }, { id: 'domain', version: 1 }, { id: 'distribution', version: 1 },
      ])
    }
  })

  it('runs sampling middleware on each invariant retry without retaining the prior scope', () => {
    const scopes: GenerationContext['sampling'][] = []
    let attempts = 0
    const distribution = middleware('distribution', (_metadata, _node, context, next) => {
      scopes.push(context.sampling)
      return next()
    })
    const runtime = createSchemaRuntime({
      kinds: standardKinds,
      behaviors: standardBehaviors.map((behavior) => behavior.id === 'distribution' ? distribution : behavior),
    })
    const schema = distribution.apply(int().in([1]).invariant(() => ++attempts === 3), true)
    const trace = createTrace()
    assert.equal(runtime.mock(schema, { trace }), 1)
    assert.equal(scopes.length, 3)
    assert.ok(scopes.every((sampling) => sampling?.candidates[0] === 1))
    assert.notEqual(scopes[0], scopes[1])
    assert.equal(trace.entries[0]?.axis, 'invariant-pass')
    assert.equal(trace.entries[0]?.attempts, 3)
  })
})
