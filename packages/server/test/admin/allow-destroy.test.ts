import { afterEach, describe, expect, it } from 'vitest'
import { connect, type Socket } from 'node:net'

import {
  createServer,
  type ListenHandle,
} from '../../src/index.js'

describe('admin allowDestroy', () => {
  let handle: ListenHandle | undefined
  afterEach(async () => {
    if (handle) await handle.close()
    handle = undefined
  })

  it('default (allowDestroy:true) → server.fetch throws AdminDestroySocketSignal', async () => {
    const server = createServer({
      routes: { 'GET /ping': () => ({ status: 200, json: { ok: true } }) },
      admin: { enabled: true },
    })
    await expect(
      server.fetch(
        new Request('http://x/ping', { headers: { 'x-mock-destroy': '1' } }),
      ),
    ).rejects.toThrow(/destroy/)
  })

  it('allowDestroy:false → fetch returns 503 instead of throwing', async () => {
    const server = createServer({
      routes: { 'GET /ping': () => ({ status: 200, json: { ok: true } }) },
      admin: { enabled: true, allowDestroy: false },
    })
    const res = await server.fetch(
      new Request('http://x/ping', { headers: { 'x-mock-destroy': '1' } }),
    )
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/disabled by admin.allowDestroy/)
  })

  it('destroy enabled via real http server drops socket cleanly', async () => {
    const server = createServer({
      routes: { 'GET /ping': () => ({ status: 200, json: { ok: true } }) },
      admin: { enabled: true },
    })
    handle = await server.listen({ port: 0, host: '127.0.0.1' })

    // Raw socket so we can observe FIN/close without fetch's retry logic.
    const sock: Socket = connect(handle.port, '127.0.0.1')
    await new Promise<void>((res, rej) => {
      sock.once('connect', () => res())
      sock.once('error', rej)
    })
    sock.write(
      'GET /ping HTTP/1.1\r\nHost: 127.0.0.1\r\nx-mock-destroy: 1\r\nConnection: close\r\n\r\n',
    )
    const result = await new Promise<{ chunks: Buffer; ended: boolean }>(
      (res) => {
        const chunks: Buffer[] = []
        sock.on('data', (c) => chunks.push(c))
        sock.on('close', () =>
          res({ chunks: Buffer.concat(chunks), ended: true }),
        )
      },
    )
    // No HTTP response was written before the socket dropped.
    expect(result.chunks.toString('utf8')).toBe('')
    expect(result.ended).toBe(true)
  })
})
