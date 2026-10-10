import { createHost } from '@databehave/core'
import { bench, describe } from 'vitest'
import { httpPlugin, httpCapability, routesPlugin } from '../src/index.js'

/** HTTP pipeline costs are measured independently of optional generation packages. */
describe('HTTP dispatch hot path', () => {
  bench('compose routes + 1k parameterized responses', async () => {
    const host = createHost({ plugins: [httpPlugin(), routesPlugin({
      'GET /api/v1/users/:id': ({ params }) => ({ json: { id: params['id'], name: 'Example', age: 42 } }),
    })] })
    await host.start()
    try {
      for (let i = 0; i < 1000; i++) {
        const response = await host.get(httpCapability).fetch(new Request(`http://localhost/api/v1/users/${i}`))
        await response.text()
      }
    } finally { await host.close() }
  })

  bench('compose routes + 1k exact responses', async () => {
    const host = createHost({ plugins: [httpPlugin(), routesPlugin({
      'GET /api/v1/users/42': () => ({ json: { id: '42', name: 'Example', age: 42 } }),
    })] })
    await host.start()
    try {
      for (let i = 0; i < 1000; i++) {
        const response = await host.get(httpCapability).fetch(new Request('http://localhost/api/v1/users/42'))
        await response.text()
      }
    } finally { await host.close() }
  })
})
