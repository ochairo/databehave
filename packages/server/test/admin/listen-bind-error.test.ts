import { createServer as createNodeHttpServer } from 'node:http'
import { describe, expect, it } from 'vitest'

import { createServer } from '../../src/index.js'

describe('server.listen — bind error', () => {
  it('rejects when the requested port is already in use', async () => {
    const blocker = createNodeHttpServer()
    await new Promise<void>((res) =>
      blocker.listen(0, '127.0.0.1', () => res()),
    )
    const addr = blocker.address()
    if (!addr || typeof addr === 'string')
      throw new Error('no address from blocker')

    try {
      const server = createServer({
        routes: { 'GET /ping': () => ({ status: 200, json: { ok: true } }) },
      })
      await expect(
        server.listen({ port: addr.port, host: '127.0.0.1' }),
      ).rejects.toThrow()
    } finally {
      await new Promise<void>((res) => blocker.close(() => res()))
    }
  })
})
