import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  arr,
  obj,
  int,
  createTrace,
  createSchemaRuntime,
  defineKind,
  defineBehavior,
  standardKinds,
  standardBehaviors,
  type Modifiers,
  type Infer,
  type KindDescriptor,
} from '../../src/index.js'

/** Test extension uses only the public package entry point. */
type Money = { readonly cents: number; readonly currency: 'USD' }
/** Kind-specific metadata retains static builder checking. */
type MoneyNode = {
  readonly kind: 'money'
  readonly ceiling: number
  readonly mods?: Modifiers
}
const money = defineKind<Money, MoneyNode>({
  id: 'money',
  version: 1,
  checkMetadata: (value) => {
    if (
      value === null ||
      typeof value !== 'object' ||
      !('kind' in value) ||
      value.kind !== 'money' ||
      !('ceiling' in value) ||
      typeof value.ceiling !== 'number' ||
      !Number.isInteger(value.ceiling) ||
      value.ceiling < 1
    )
      throw new TypeError('invalid money metadata')
    return {
      kind: 'money',
      ceiling: value.ceiling,
      ...('mods' in value ? { mods: value.mods as Modifiers } : {}),
    }
  },
  generate: (node, context) => ({
    cents: context.leafRng().int(0, node.ceiling),
    currency: 'USD',
  }),
  validate: (_node, value, context) => {
    if (
      value === null ||
      typeof value !== 'object' ||
      !('cents' in value) ||
      !Number.isInteger(value.cents) ||
      !('currency' in value) ||
      value.currency !== 'USD'
    )
      context.issues.push({
        path: context.path,
        code: 'money.invalid',
        message: 'expected USD cents',
      })
    return value
  },
  children: () => [],
  rebuild: (node) => ({ ...node }),
})
const round = defineBehavior<number>({
  id: 'round',
  version: 1,
  phase: 'sample',
  checkMetadata: (value) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1)
      throw new TypeError('invalid rounding step')
    return value
  },
  appliesTo: (node) => node.kind === 'money',
  merge: (_previous, next) => next,
  generate: (step, _node, _context, next) => {
    const value = next() as Money
    return { ...value, cents: Math.floor(value.cents / step) * step }
  },
  validate: (step, _node, input, context, next) => {
    const result = next()
    if (
      input !== null &&
      typeof input === 'object' &&
      'cents' in input &&
      typeof input.cents === 'number' &&
      input.cents % step !== 0
    )
      context.issues.push({
        path: context.path,
        code: 'round.invalid',
        message: 'not a multiple of the rounding step',
      })
    return result
  },
  serialize: (value) => value,
})
const runtime = () =>
  createSchemaRuntime({
    kinds: [...standardKinds, money],
    behaviors: [...standardBehaviors, round],
  })

describe('public schema plugin composition', () => {
  it('supports a custom kind and behavior nested in standard composites across every operation', () => {
    const rt = runtime()
    const price = round.apply(money.schema({ ceiling: 1000 }), 10)
    const schema = obj({ prices: arr(price).length(3) })
    const trace = createTrace()
    const value = rt.mock(schema, { seed: 'money', trace })
    const inferred: Infer<typeof schema> = {
      prices: [{ cents: 100, currency: 'USD' }],
    }
    assert.equal(inferred.prices[0]?.currency, 'USD')
    assert.equal(value.prices.length, 3)
    assert.ok(value.prices.every((item) => item.currency === 'USD' && item.cents % 10 === 0))
    assert.deepEqual(rt.parse(schema, value), value)
    assert.equal(rt.safeParse(schema, { prices: [{ cents: 3, currency: 'USD' }] }).ok, false)
    const visited: string[] = []
    rt.walkSchema(schema, {
      enter: (node, path) => {
        visited.push(`${node.kind}:${path.join('/')}`)
      },
    })
    assert.deepEqual(visited, ['object:', 'array:prices', 'money:prices/[]'])
    const envelope = rt.serializeSchema(schema)
    assert.ok(envelope.contracts.kinds.some((c) => c.id === 'money' && c.version === 1))
    assert.ok(envelope.contracts.behaviors.some((c) => c.id === 'round' && c.version === 1))
    const restored = rt.deserializeSchema(JSON.parse(JSON.stringify(envelope)))
    assert.deepEqual(rt.mock(restored, { seed: 'money' }), value)
    assert.deepEqual(rt.mock(rt.fromIR(schema._node), { seed: 'money' }), value)
    const replay = rt.replay(schema, { seed: 'money' })
    assert.deepEqual(replay(), value)
    assert.deepEqual(replay(), value)
    assert.deepEqual(replay.contracts, envelope.contracts)
    assert.ok(
      trace.entries.some(
        (e) => e.contracts?.kind.id === 'money' && e.contracts.behaviors.some((c) => c.id === 'round'),
      ),
    )
  })
  it('keeps custom generation in dataset rows and snapshots replay metadata', () => {
    const rt = runtime()
    const schema = obj({ id: int().min(0).max(100000), price: money.schema({ ceiling: 1000 }) })
    const rows = rt.mockDataset({ name: 'money', schema, identity: ['id'], n: 3 })
    assert.equal(rows.length, 3)
    assert.ok(rows.every((row) => row.price.currency === 'USD'))
    const values = arr(money.schema({ ceiling: 1000 })).length(2)
    const replay = rt.replay(values, { seed: 'snapshot' })
    const expected = replay()
    ;(values._node as { length: number }).length = 4
    assert.deepEqual(replay(), expected)
    assert.equal(replay().length, 2)
  })
  it('rejects custom closure serialization even when a codec tries to discard the callback', () => {
    const closure = defineBehavior<{ readonly callback?: () => number }>({
      id: 'closure',
      version: 1,
      phase: 'sample',
      checkMetadata: (input) => {
        if (input === null || typeof input !== 'object') throw new TypeError('expected object')
        if ('callback' in input && typeof input.callback !== 'function')
          throw new TypeError('expected callback')
        return input
      },
      appliesTo: () => true,
      merge: (_a, b) => b,
      generate: (_metadata, _node, _context, next) => next(),
      validate: (_metadata, _node, _value, _context, next) => next(),
      serialize: () => ({}),
    })
    const rt = createSchemaRuntime({ kinds: standardKinds, behaviors: [...standardBehaviors, closure] })
    assert.throws(() => rt.serializeSchema(closure.apply(int(), { callback: () => 1 })), /closures/)
  })
  it('preserves domain fallback trace and omits unresolved failing samples', () => {
    const rt = runtime()
    const trace = createTrace()
    rt.mock(int().in([]), { trace })
    assert.equal(trace.entries[0]?.axis, 'domain')
    const failed = createTrace()
    assert.throws(() => rt.mock(int().min(10).max(1), { trace: failed }), /min/)
    assert.equal(failed.entries.length, 0)
  })
  it('isolates instances and replaces official descriptors through the same protocol', () => {
    const first = runtime()
    const second = createSchemaRuntime({
      kinds: [...standardKinds, { ...money, generate: () => ({ cents: 2000, currency: 'USD' }) }],
      behaviors: standardBehaviors,
    })
    const schema = obj({ price: money.schema({ ceiling: 1 }) })
    assert.notDeepEqual(first.mock(schema), second.mock(schema))
    const number = standardKinds.find((kind) => kind.id === 'number')
    assert.ok(number)
    const replacement = createSchemaRuntime({
      kinds: standardKinds.map((kind) => (kind.id === 'number' ? { ...kind, generate: () => 77 } : kind)),
      behaviors: standardBehaviors,
    })
    assert.deepEqual(replacement.mock(obj({ n: int() })), { n: 77 })
    assert.throws(
      () =>
        createSchemaRuntime({
          kinds: [...standardKinds, number],
          behaviors: standardBehaviors,
        }),
      /duplicate/,
    )
    assert.throws(
      () =>
        createSchemaRuntime({
          kinds: standardKinds,
          behaviors: [...standardBehaviors, round, round],
        }),
      /duplicate/,
    )
  })
  it('rejects missing, incompatible and malformed contracts instead of dropping data', () => {
    const rt = runtime()
    const schema = rt.withBehavior(money.schema({ ceiling: 100 }), 'round', 10)
    const encoded = rt.serializeSchema(schema)
    assert.throws(
      () =>
        createSchemaRuntime({
          kinds: standardKinds,
          behaviors: standardBehaviors,
        }).fromIR(schema._node),
      /missing schema kind/,
    )
    assert.throws(
      () =>
        createSchemaRuntime({
          kinds: [...standardKinds, money],
          behaviors: standardBehaviors,
        }).fromIR(schema._node),
      /missing schema behavior/,
    )
    assert.throws(
      () =>
        rt.deserializeSchema({
          ...encoded,
          contracts: {
            ...encoded.contracts,
            kinds: [{ id: 'money', version: 2 }],
          },
        }),
      /incompatible/,
    )
    assert.throws(
      () =>
        rt.deserializeSchema({
          ...encoded,
          contracts: { ...encoded.contracts, behaviors: [] },
        }),
      /incorrect/,
    )
    assert.throws(
      () =>
        rt.fromIR({
          kind: 'object',
          fields: { child: { kind: 'money', ceiling: 'oops' } },
        }),
      /invalid money/,
    )
    assert.throws(() => rt.fromIR({ kind: 'array', item: null }), /metadata/)
    assert.throws(() => rt.withBehavior(int(), 'round', 10), /not applicable/)
    assert.throws(() => rt.withBehavior(schema, 'round', 0), /invalid rounding/)
    const incomplete = { id: 'incomplete', version: 1 } as KindDescriptor
    assert.throws(() => createSchemaRuntime({ kinds: [incomplete], behaviors: [] }), /missing handler/)
    assert.throws(() => rt.serializeSchema(obj({ n: int().derivedFrom(() => 2) })), /closure/)
  })
  it('seals descriptor copies and preserves short circuits outside invariants', () => {
    const mutable = {
      ...money,
      generate: () => ({ cents: 10, currency: 'USD' as const }),
    }
    const rt = createSchemaRuntime({
      kinds: [...standardKinds, mutable],
      behaviors: standardBehaviors,
    })
    mutable.generate = () => ({ cents: 20, currency: 'USD' })
    assert.equal(rt.mock(money.schema({ ceiling: 100 })).cents, 10)
    let calls = 0
    const schema = int()
      .occasionally(7, 1)
      .eventually(2, 9)
      .invariant(() => {
        calls++
        return false
      })
    assert.equal(rt.mock(schema, { index: 0 }), 9)
    assert.equal(rt.mock(schema, { index: 1 }), 7)
    assert.equal(calls, 0)
    assert.throws(
      () =>
        rt.mock(
          int().invariant(() => {
            calls++
            return false
          }),
        ),
      /100 attempts/,
    )
    assert.equal(calls, 100)
    assert.equal(
      rt.safeParse(
        int().invariant(() => false),
        1,
      ).ok,
      false,
    )
  })
})

// Compile-only contracts: metadata and inferred values stay specific across extensions.
const checkExtensionTypes = (): void => {
  // @ts-expect-error money ceiling is numeric
  money.schema({ ceiling: '100' })
  // @ts-expect-error custom behavior metadata is numeric
  round.apply(money.schema({ ceiling: 100 }), '10')
  const nested = obj({ values: arr(money.schema({ ceiling: 100 })) })
  // @ts-expect-error nested custom inference preserves the literal currency
  const wrong: Infer<typeof nested> = { values: [{ cents: 100, currency: 'EUR' }] }
  void wrong
}

void checkExtensionTypes
