import assert from 'node:assert/strict'
import { createHost } from '@databehave/core'
import { httpPlugin, routesPlugin, nodeHttpPlugin, listenerCapability } from '@databehave/server'

const host = createHost({ plugins: [
  httpPlugin(),
  routesPlugin({ 'GET /hello': () => ({ json: { message: 'hello' } }) }),
  nodeHttpPlugin({ host: '127.0.0.1', port: 0 }),
] })
try {
  await host.start()
  const { port } = host.get(listenerCapability).address
  const response = await fetch(`http://127.0.0.1:${port}/hello`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { message: 'hello' })
  console.log('HTTP example passed')
} finally { await host.close() }
