import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createServer,
  type ListenHandle,
} from '../../src/index.js'

describe('admin disabled by default', () => {
  let handle: ListenHandle | undefined
  afterEach(async () => {
    if (handle) await handle.close()
    handle = undefined
  })

  it('no /_mock/* routes exist', async () => {
    const server = createServer({
      routes: { 'GET /ping': () => ({ status: 200, json: { ok: true } }) },
    })
    const res = await server.fetch(new Request('http://x/_mock/overrides'))
    expect(res.status).toBe(404)
  })

  it('x-mock-status header is IGNORED (handler runs as normal)', async () => {
    const server = createServer({
      routes: { 'GET /ping': () => ({ status: 200, json: { ok: true } }) },
    })
    const res = await server.fetch(
      new Request('http://x/ping', { headers: { 'x-mock-status': '500' } }),
    )
    expect(res.status).toBe(200)
  })

  it('no banner emitted at listen()', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      const server = createServer({})
      handle = await server.listen({ port: 0, host: '127.0.0.1' })
      const enabled = spy.mock.calls.filter((c) =>
        String(c[0]).includes('admin panel ready'),
      )
      expect(enabled).toHaveLength(0)
    } finally {
      spy.mockRestore()
    }
  })

  it('admin: { enabled: false } is treated as disabled', async () => {
    const server = createServer({
      admin: { enabled: false },
    })
    const res = await server.fetch(new Request('http://x/_mock/overrides'))
    expect(res.status).toBe(404)
  })

  it('enabling admin + user route at same path → fail-fast', () => {
    expect(() =>
      createServer({
        routes: {
          'GET /databehave/overrides': () => ({ status: 200, json: {} }),
        },
        admin: { enabled: true },
      }),
    ).toThrow(/collides/)
  })
})
