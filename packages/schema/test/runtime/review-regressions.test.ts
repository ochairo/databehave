import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  arr,
  createSchemaRuntime,
  decimal,
  defineKind,
  discriminated,
  int,
  literal,
  null_,
  obj,
  standardBehaviors,
  standardKinds,
  union,
  type Modifiers,
  type TypedKind,
} from '../../src/index.js'

/** External kind metadata has no dependency on a standard kind ID. */
type AbsentNode<K extends string> = { readonly kind: K; readonly mods?: Modifiers }
const absentKind = <T extends null | undefined, K extends string>(
  id: K,
  accepted: T,
): TypedKind<T, AbsentNode<K>> =>
  defineKind<T, AbsentNode<K>>({
    id,
    version: 1,
    checkMetadata: (input) => {
      if (input === null || typeof input !== 'object' || !('kind' in input) || input.kind !== id)
        throw new TypeError(`expected ${id} metadata`)
      return { kind: id, ...('mods' in input ? { mods: input.mods as Modifiers } : {}) }
    },
    generate: () => accepted,
    validate: (_node, value, context) => {
      if (value !== accepted)
        context.issues.push({ path: context.path, code: `${id}.invalid`, message: `expected ${id}` })
      return value
    },
    children: () => [],
    rebuild: (node) => ({ ...node }),
  })
const nil = absentKind('nil', null)
const missing = absentKind('missing', undefined)
const runtime = createSchemaRuntime({ kinds: [...standardKinds, nil, missing], behaviors: standardBehaviors })

describe('review regressions: descriptor validation ownership', () => {
  it('rejects malformed discriminated branches from IR and serialized input', () => {
    const valid = discriminated('tag', { a: obj({ tag: literal('a'), value: int() }) })
    const envelope = runtime.serializeSchema(valid)
    const invalidBranches = [
      { kind: 'number', int: true },
      { kind: 'object', fields: {} },
      { kind: 'object', fields: { tag: { kind: 'string', format: 'plain' } } },
      { kind: 'object', fields: { tag: { kind: 'literal', value: 'other' } } },
    ]
    for (const branch of invalidBranches) {
      const node = { kind: 'discriminated', key: 'tag', branches: { a: branch } }
      assert.throws(() => runtime.fromIR(node), /discriminated:/)
      assert.throws(() => runtime.deserializeSchema({ ...envelope, node }), /discriminated:/)
    }
  })

  it('preserves valid discriminated branches containing external kinds', () => {
    const schema = discriminated('tag', { a: obj({ tag: literal('a'), value: nil.schema({}) }) })
    const expected = { tag: 'a', value: null }
    const fromIR = runtime.fromIR(schema._node)
    const fromJSON = runtime.deserializeSchema(JSON.parse(JSON.stringify(runtime.serializeSchema(schema))))
    for (const restored of [fromIR, fromJSON]) {
      assert.deepEqual(runtime.mock(restored), expected)
      assert.deepEqual(runtime.parse(restored, expected), expected)
    }
  })

  it('lets external kind validators accept null and explicit undefined with standard behaviors', () => {
    assert.equal(runtime.parse(nil.schema({}), null), null)
    assert.equal(runtime.parse(missing.schema({}), undefined), undefined)
    assert.equal(runtime.safeParse(nil.schema({}), undefined).ok, false)
    assert.equal(runtime.safeParse(missing.schema({}), null).ok, false)
    const schema = obj({
      nil: nil.schema({}), missingValues: arr(missing.schema({})).length(2),
      requiredMissing: missing.schema({}), deferredMissing: missing.schema({}).derivedFrom(() => undefined),
      optionalMissing: missing.schema({}).optional(),
    })
    const expected = { nil: null, missingValues: [undefined, undefined], requiredMissing: undefined, deferredMissing: undefined }
    assert.deepEqual(runtime.mock(schema), expected)
    assert.deepEqual(runtime.parse(schema, expected), expected)
  })

  it('retains standard required/null diagnostics in standard kind validation', () => {
    for (const behaviors of [standardBehaviors, []]) {
      const standard = createSchemaRuntime({ kinds: standardKinds, behaviors })
      const required = standard.safeParse(int(), undefined)
      assert.equal(required.ok, false)
      if (!required.ok)
        assert.deepEqual(
          required.error.issues.map((issue) => issue.code),
          ['required'],
        )
      const unexpected = standard.safeParse(int(), null)
      assert.equal(unexpected.ok, false)
      if (!unexpected.ok)
        assert.deepEqual(
          unexpected.error.issues.map((issue) => issue.code),
          ['unexpected-null'],
        )
      assert.equal(standard.parse(null_(), null), null)
    }
  })

  it('delegates absent union values to branches and accepts literal null', () => {
    for (const schema of [null_(), literal(null), union(int(), null_()), union(int(), nil.schema({}))]) {
      assert.equal(runtime.parse(schema, null), null)
      const restored = runtime.deserializeSchema(runtime.serializeSchema(schema))
      assert.equal(runtime.parse(restored, null), null)
    }
    for (const schema of [union(int(), missing.schema({})), union(int(), int().optional())])
      assert.equal(runtime.parse(schema, undefined), undefined)
    assert.deepEqual(runtime.parse(obj({ value: union(int(), literal(null)) }), { value: null }), { value: null })
    const rejected = runtime.safeParse(union(int(), literal('x')), null)
    assert.equal(rejected.ok, false)
    if (!rejected.ok) assert.equal(rejected.error.issues[0]?.code, 'union.no-match')
  })

  it('passes missing optional fields through the selected modifier in both object passes', () => {
    const modifiers = standardBehaviors.find((behavior) => behavior.id === 'modifiers')
    assert.ok(modifiers)
    const seen: (readonly (string | number)[])[] = []
    const replacement = {
      ...modifiers,
      validate: ((metadata, node, value, context, next) => {
        if (node.kind === 'number' && value === undefined) {
          seen.push(context.path)
          return 41
        }
        return modifiers.validate(metadata, node, value, context, next)
      }) satisfies typeof modifiers.validate,
    }
    const configured = createSchemaRuntime({
      kinds: standardKinds,
      behaviors: standardBehaviors.map((behavior) => (behavior.id === 'modifiers' ? replacement : behavior)),
    })
    const schema = obj({
      inner: obj({
        first: int().optional().default(1),
        deferred: int()
          .optional()
          .derivedFrom(() => 42),
      }),
    })
    assert.deepEqual(configured.parse(schema, { inner: {} }), { inner: { first: 41, deferred: 41 } })
    assert.deepEqual(seen, [
      ['inner', 'first'],
      ['inner', 'deferred'],
    ])
    assert.deepEqual(runtime.parse(schema, { inner: {} }), { inner: {} })
  })

  it('rejects decimal precision outside the builder limit before generation', () => {
    const envelope = runtime.serializeSchema(decimal(38, 38))
    for (const precision of [39, Number.MAX_SAFE_INTEGER]) {
      const node = { kind: 'decimal', precision, scale: precision }
      assert.throws(() => runtime.fromIR(node), /invalid decimal precision\/scale/)
      assert.throws(
        () => runtime.deserializeSchema({ ...envelope, node }),
        /invalid decimal precision\/scale/,
      )
    }
    assert.equal(runtime.fromIR(envelope.node)._node.precision, 38)
  })
})
