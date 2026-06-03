import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'

import {
  createServer,
  type ListenHandle,
} from '../../src/index.js'

/**
 * End-to-end check with `admin: { enabled: true }`: a real HTTP
 * request with `x-mock-business-failure-b64: <utf8>` returns the
 * 200 + `{success:false, message}` envelope that consumer http
 * clients translate to a business failure.
 */
describe('admin business-failure integration (real HTTP)', () => {
  let handle: ListenHandle

  beforeAll(async () => {
    const server = createServer({
      routes: {
        'POST /api/v1/widgets/copy': () => ({
          status: 200,
          json: { success: true, data: 'real-response' },
        }),
      },
      admin: { enabled: true },
    })
    handle = await server.listen({ port: 0, host: '127.0.0.1' })
  })

  afterAll(async () => {
    if (handle) await handle.close()
  })

  it('returns 200 + {success:false, message} (via -b64 header for unicode)', async () => {
    const url = `http://${handle.host}:${handle.port}/api/v1/widgets/copy`
    const msg = 'cannot copy: record was modified during operation — café'
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mock-business-failure-b64': Buffer.from(msg, 'utf8').toString(
          'base64',
        ),
      },
      body: JSON.stringify({ widgetId: 1 }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; message: string }
    expect(body.success).toBe(false)
    expect(body.message).toBe(msg)
    expect(res.headers.get('x-mock-injected')).toContain('business-failure')
  })

  it('ASCII message via x-mock-business-failure works directly', async () => {
    const url = `http://${handle.host}:${handle.port}/api/v1/widgets/copy`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mock-business-failure': 'conflict: row was updated by another user',
      },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; message: string }
    expect(body.success).toBe(false)
    expect(body.message).toBe('conflict: row was updated by another user')
  })

  it('without the header, the real handler runs', async () => {
    const url = `http://${handle.host}:${handle.port}/api/v1/widgets/copy`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean }
    expect(body.success).toBe(true)
  })

  it('admin routes are reachable under default /databehave path', async () => {
    const url = `http://${handle.host}:${handle.port}/databehave/overrides`
    const res = await fetch(url)
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})
