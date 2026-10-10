import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  createSchemaRuntime, defineBehavior, defineKind, Schema,
  type BehaviorDescriptor, type BehaviorPhase, type GenerationContext, type GenerationNext,
  type KindDefinition, type SchemaNode, type ValidationContext,
} from '../../src/index.js'

class StatefulKind implements KindDefinition<number, SchemaNode> {
  id = 'stateful'
  version = 1
  #value = 10
  #name = 'stateful'
  setValue(value: number): void { this.#value = value }
  describe(): string { return this.#name }
  checkMetadata(input: unknown): SchemaNode {
    if (input === null || typeof input !== 'object' || !('kind' in input) || input.kind !== this.#name)
      throw new TypeError('invalid stateful metadata')
    return input as SchemaNode
  }
  generate(): number { return this.#value }
  validate(_node: SchemaNode, value: unknown, context: ValidationContext): unknown {
    if (value !== this.#value)
      context.issues.push({ path: context.path, code: 'stateful.value', message: context.describe(_node) })
    return value
  }
  children(): [] { assert.equal(this.#name, 'stateful'); return [] }
  rebuild(node: SchemaNode): SchemaNode { assert.equal(this.#name, node.kind); return { ...node } }
}

class StatefulBehavior implements BehaviorDescriptor {
  id = 'offset'
  version = 1
  phase: BehaviorPhase = 'sample'
  #carrier = 'offset'
  #factor = 1
  setFactor(factor: number): void { this.#factor = factor }
  read(node: SchemaNode): unknown { return node.mods?.behaviors?.[this.#carrier] }
  write(node: SchemaNode, metadata: unknown): SchemaNode {
    return { ...node, mods: { ...node.mods, behaviors: { [this.#carrier]: metadata } } }
  }
  checkMetadata(value: unknown): number {
    assert.equal(this.#carrier, 'offset')
    if (typeof value !== 'number') throw new TypeError('invalid offset')
    return value
  }
  appliesTo(node: SchemaNode): boolean { assert.equal(this.#carrier, 'offset'); return node.kind === 'stateful' }
  merge(previous: unknown, next: unknown): number {
    assert.equal(this.#carrier, 'offset')
    return Number(previous) + Number(next)
  }
  generate(metadata: unknown, _node: SchemaNode, _context: GenerationContext, next: GenerationNext): unknown {
    return Number(next()) + Number(metadata) * this.#factor
  }
  validate(_metadata: unknown, _node: SchemaNode, _value: unknown, _context: ValidationContext, next: () => unknown): unknown {
    assert.equal(this.#carrier, 'offset')
    return next()
  }
  serialize(metadata: unknown): unknown { assert.equal(this.#carrier, 'offset'); return metadata }
}

const replaced = (): never => { throw new Error('replacement callback must not run') }
const replaceKind = (kind: StatefulKind): void => {
  kind.id = 'changed'
  kind.version = 9
  kind.describe = replaced
  kind.checkMetadata = replaced
  kind.generate = replaced
  kind.validate = replaced
  kind.children = replaced
  kind.rebuild = replaced
}
const replaceBehavior = (behavior: StatefulBehavior): void => {
  behavior.id = 'changed'
  behavior.version = 9
  behavior.phase = 'modifier'
  behavior.read = replaced
  behavior.write = replaced
  behavior.checkMetadata = replaced
  behavior.appliesTo = replaced
  behavior.merge = replaced
  behavior.generate = replaced
  behavior.validate = replaced
  behavior.serialize = replaced
}

describe('descriptor identity and callback snapshots', () => {
  for (const helpers of [true, false]) {
    it(`${helpers ? 'authoring helpers' : 'runtime registry'} preserve prototype callbacks and private receivers`, () => {
      const originalKind = new StatefulKind()
      const originalBehavior = new StatefulBehavior()
      const kind = helpers ? defineKind(originalKind) : originalKind
      const behavior = helpers ? defineBehavior<number>(originalBehavior) : originalBehavior
      if (helpers) {
        replaceKind(originalKind)
        replaceBehavior(originalBehavior)
      }
      const runtime = createSchemaRuntime({ kinds: [kind], behaviors: [behavior] })
      if (!helpers) {
        replaceKind(originalKind)
        replaceBehavior(originalBehavior)
      }
      const schema = 'schema' in kind ? kind.schema({}) : new Schema<number>({ kind: 'stateful' })
      const applied = 'apply' in behavior ? behavior.apply(schema, 2) : runtime.withBehavior(schema, 'offset', 2)
      const combined = runtime.withBehavior(applied, 'offset', 3)
      assert.deepEqual(combined._node.mods?.behaviors, { offset: 5 })
      assert.equal(runtime.mock(combined), 15)
      assert.equal(runtime.parse(schema, 10), 10)
      assert.equal(runtime.parse(combined, 10), 10)
      const invalid = runtime.safeParse(schema, 0)
      assert.equal(invalid.ok, false)
      if (!invalid.ok) assert.equal(invalid.error.issues[0]?.message, 'stateful')
      const encoded = runtime.serializeSchema(combined)
      assert.deepEqual(encoded.contracts, {
        kinds: [{ id: 'stateful', version: 1 }], behaviors: [{ id: 'offset', version: 1 }],
      })
      assert.equal(runtime.mock(runtime.deserializeSchema(encoded)), 15)
      const replay = runtime.replay(combined)
      originalKind.setValue(20)
      originalBehavior.setFactor(2)
      assert.equal(runtime.mock(combined), 30)
      assert.equal(replay(), 30)
    })
  }
})
