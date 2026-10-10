import assert from 'node:assert/strict'
import { capability, createHost } from '@databehave/core'

const greeting = capability('example.greeting', 1)
const host = createHost({ plugins: [{
  id: 'example.greeting', apiVersion: 1, provides: [greeting],
  setup(context) { context.provide(greeting, { text: 'Hello from a plugin' }) },
}] })
try {
  await host.start()
  assert.equal(host.get(greeting).text, 'Hello from a plugin')
  console.log(host.get(greeting).text)
} finally { await host.close() }
