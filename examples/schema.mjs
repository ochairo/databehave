import assert from 'node:assert/strict'
import { createSchemaRuntime, standardKinds, standardBehaviors, obj, int, str } from '@databehave/schema'

const runtime = createSchemaRuntime({ kinds: standardKinds, behaviors: standardBehaviors })
const user = obj({ id: int().min(1).max(10), role: str().in(['reader', 'writer']) })
const value = runtime.mock(user, { seed: 42 })
assert.equal(runtime.safeParse(user, value).ok, true)
assert.deepEqual(runtime.mock(user, { seed: 42 }), value)
assert.deepEqual(runtime.mock(runtime.deserializeSchema(runtime.serializeSchema(user)), { seed: 42 }), value)
console.log(value)
