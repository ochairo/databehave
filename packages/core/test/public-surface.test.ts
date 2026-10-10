import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import * as api from '../src/index.js'

test('public runtime exports remain minimal', () => {
  assert.deepEqual(Object.keys(api).sort(), ['capability', 'createHost'])
})
