import { afterEach, describe, expect, it } from 'vitest'

import {
  createServer,
  type ListenHandle,
} from '../../src/index.js'

describe('admin bind policy', () => {
  let openHandle: ListenHandle | undefined

  afterEach(async () => {
    if (openHandle) {
      await openHandle.close().catch(() => {})
      openHandle = undefined
    }
  })

  it('refuses 0.0.0.0 by default (loopback-only)', async () => {
    const server = createServer({
      admin: { enabled: true },
    })
    await expect(
      server.listen({ port: 0, host: '0.0.0.0' }),
    ).rejects.toThrow(/admin is enabled.*0\.0\.0\.0/)
  })

  it("accepts 0.0.0.0 when bind: 'any'", async () => {
    const server = createServer({
      admin: { enabled: true, bind: 'any' },
    })
    openHandle = await server.listen({ port: 0, host: '127.0.0.1' })
    expect(openHandle.port).toBeGreaterThan(0)
  })

  it('accepts loopback variants', async () => {
    for (const host of ['127.0.0.1', '::1', 'localhost']) {
      const server = createServer({
        admin: { enabled: true },
      })
      const h = await server.listen({ port: 0, host })
      expect(h.port).toBeGreaterThan(0)
      await h.close()
    }
  })

  it('default host (127.0.0.1) is accepted with no listen opts', async () => {
    const server = createServer({
      admin: { enabled: true },
    })
    openHandle = await server.listen()
    expect(openHandle.port).toBeGreaterThan(0)
  })

  it('rejects admin.path without leading slash at construction', () => {
    expect(() =>
      createServer({
        admin: { enabled: true, path: 'bad' },
      }),
    ).toThrow(/must start with/)
  })
})
