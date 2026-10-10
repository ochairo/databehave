import assert from 'node:assert/strict'
import { createSchemaRuntime, defineKind, defineBehavior } from '@databehave/schema/runtime'
import { standardKinds, standardBehaviors } from '@databehave/schema/standard'
import { arr, obj } from '@databehave/schema'

const money = defineKind({
  id: 'money', version: 1,
  checkMetadata(value) {
    if (!value || value.kind !== 'money' || !Number.isInteger(value.ceiling)) throw new TypeError('invalid money')
    return value
  },
  generate: (node, ctx) => ctx.leafRng().int(0, node.ceiling),
  validate(_node, value, ctx) {
    if (!Number.isInteger(value)) ctx.issues.push({ path: ctx.path, code: 'money.invalid', message: 'expected cents' })
    return value
  },
  children: () => [], rebuild: (node) => ({ ...node }),
})
const rounding = defineBehavior({
  id: 'rounding', version: 1, phase: 'sample',
  checkMetadata(value) { if (!Number.isInteger(value) || value < 1) throw new TypeError('invalid step'); return value },
  appliesTo: (node) => node.kind === 'money', merge: (_a, b) => b,
  generate: (step, _node, _ctx, next) => Math.floor(next() / step) * step,
  validate(step, _node, value, ctx, next) {
    if (value % step !== 0) ctx.issues.push({ path: ctx.path, code: 'rounding.invalid', message: 'not rounded' })
    return next()
  },
  serialize: (value) => value,
})
const runtime = createSchemaRuntime({ kinds: [...standardKinds, money], behaviors: [...standardBehaviors, rounding] })
const schema = obj({ prices: arr(rounding.apply(money.schema({ ceiling: 1000 }), 10)).length(3) })
const value = runtime.mock(schema, { seed: 'packaged' })
assert.deepEqual(runtime.parse(schema, value), value)
const restored = runtime.deserializeSchema(JSON.parse(JSON.stringify(runtime.serializeSchema(schema))))
assert.deepEqual(runtime.mock(restored, { seed: 'packaged' }), value)
const kinds = []
runtime.walkSchema(restored, { enter: (node) => { kinds.push(node.kind) } })
assert.deepEqual(kinds, ['object', 'array', 'money'])
assert.deepEqual(runtime.replay(schema, { seed: 'packaged' })(), value)
console.log('Packaged standalone runtime: custom kind + behavior passed without the optional host installed.')
