import { createHost, type Host } from '@databehave/core'
import { Agent, request } from 'node:http'
import { connect } from 'node:net'
import { describe, expect, it } from 'vitest'
import { httpPlugin, listenerCapability, nodeHttpPlugin, routesPlugin } from '../src/index.js'

const port = (host: Host): number => {
  const address = host.get(listenerCapability).address
  if (!address) throw new Error('Listener unavailable')
  return address.port
}

const raw = (host: Host, message: string, hostname = '127.0.0.1'): Promise<string> => new Promise((resolve, reject) => {
  const socket = connect(port(host), hostname)
  let data = ''
  socket.setEncoding('utf8')
  socket.setTimeout(2000, () => socket.destroy(new Error('Socket test timed out')))
  socket.on('error', reject)
  socket.on('data', (chunk: string) => { data += chunk })
  socket.on('end', () => resolve(data))
  socket.on('connect', () => socket.write(message.replaceAll('$PORT', String(port(host)))))
})

describe('Node authority boundary', () => {
  it('rejects forged authorities and malformed targets before any route executes', async () => {
    let calls = 0
    const host = createHost({ plugins: [httpPlugin(), nodeHttpPlugin(), routesPlugin({ 'GET /': () => { calls++; return { text: 'ok' } } })] })
    await host.start()
    try {
      const cases: readonly [string, string, number][] = [
        ['/', 'evil.example:$PORT', 421], ['/', '127.0.0.1:1', 421],
        ['/', '127.0.0.1:0', 400], ['/', '127.0.0.1:99999', 400],
        ['/', '[nope]:$PORT', 400], ['/', '[::gg]:$PORT', 400], ['/', '[:::]:$PORT', 400],
        ['/', 'bad..name:$PORT', 400], ['/', '-bad.name:$PORT', 400],
        ['/', 'evil.example/path', 400], ['/', 'localhost:$PORT\r\nHost: evil.example:$PORT', 400],
        ['http://evil.example/', 'localhost:$PORT', 400], ['//evil.example/', 'localhost:$PORT', 400],
        ['/\\evil.example/', 'localhost:$PORT', 400], ['/path#fragment', 'localhost:$PORT', 400],
        ['/\u0001', 'localhost:$PORT', 400],
      ]
      for (const [target, authority, status] of cases) {
        const response = await raw(host, `GET ${target} HTTP/1.1\r\nHost: ${authority}\r\nOrigin: http://${authority}\r\nConnection: close\r\n\r\n`)
        expect(response, `${target} ${authority}`).toContain(`HTTP/1.1 ${status}`)
      }
      expect(await raw(host, 'GET / HTTP/1.0\r\n\r\n')).toContain('HTTP/1.1 400')
      expect(calls).toBe(0)
      expect(await raw(host, 'GET / HTTP/1.1\r\nHost: localhost:$PORT\r\nConnection: close\r\n\r\n')).toContain('200 OK')
      expect(await raw(host, 'GET / HTTP/1.1\r\nHost: 127.0.0.2:$PORT\r\nConnection: close\r\n\r\n')).toContain('200 OK')
    } finally { await host.close() }
  })

  it('allows only explicit custom DNS names on the actual port', async () => {
    const host = createHost({ plugins: [httpPlugin(), nodeHttpPlugin({ host: '0.0.0.0', allowedHosts: ['app.test'] })] })
    await host.start()
    try {
      expect(await raw(host, 'GET / HTTP/1.1\r\nHost: app.test:$PORT\r\nConnection: close\r\n\r\n')).toContain('404 Not Found')
      expect(await raw(host, 'GET / HTTP/1.1\r\nHost: app.test\r\nConnection: close\r\n\r\n')).toContain('421')
    } finally { await host.close() }
  })

  it('accepts bracketed IPv6 on an IPv6 listener', async () => {
    const host = createHost({ plugins: [httpPlugin(), nodeHttpPlugin({ host: '::1' })] })
    await host.start()
    try {
      for (const authority of ['[::1]', '[0:0:0:0:0:0:0:1]', 'localhost']) {
        expect(await raw(host, `GET / HTTP/1.1\r\nHost: ${authority}:$PORT\r\nConnection: close\r\n\r\n`, '::1')).toContain('404 Not Found')
      }
    }
    finally { await host.close() }
  })

  it.each(['*.example', 'https://example', 'example:80', 'user@example', 'example/path', '[:::]', 'a'.repeat(64) + '.test'])('rejects invalid allowedHosts %s', (hostname) => {
    expect(() => nodeHttpPlugin({ allowedHosts: [hostname] })).toThrow('Invalid allowed hostname')
  })
})

describe('Node upload ownership', () => {
  it('keeps input alive while a delayed response streams it after the handler returns', async () => {
    const host = createHost({ plugins: [httpPlugin({ drainTimeoutMs: 20 }), nodeHttpPlugin(), routesPlugin({
      'POST /': (req) => ({ raw: req.raw().body! }),
    })] })
    await host.start()
    let client: ReturnType<typeof request> | undefined
    let finishUpload: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await new Promise<string>((resolve, reject) => {
        client = request({ host: '127.0.0.1', port: port(host), method: 'POST' }, (response) => {
          let text = ''
          response.on('data', (chunk: Buffer) => { text += chunk.toString() })
          response.on('error', reject)
          response.on('end', () => resolve(text))
        })
        client.on('error', reject)
        client.write('first ')
        finishUpload = setTimeout(() => client?.end('second'), 80)
      })
      expect(result).toBe('first second')
    } finally { clearTimeout(finishUpload); client?.destroy(); await host.close() }
  })

  it('flushes an early rejection after cancelling both tee branches while upload remains open', async () => {
    const host = createHost({ plugins: [httpPlugin({ drainTimeoutMs: 100 }), nodeHttpPlugin(), routesPlugin({ 'POST /': async (req) => {
      const reader = req.raw().clone().body?.getReader()
      await reader?.read()
      void reader?.cancel().catch(() => undefined)
      void req.raw().body?.cancel().catch(() => undefined)
      return { status: 413, text: 'too large' }
    } })] })
    await host.start()
    try {
      const response = await raw(host, 'POST / HTTP/1.1\r\nHost: localhost:$PORT\r\nContent-Length: 1000000\r\n\r\npartial')
      expect(response).toContain('413 Payload Too Large')
      expect(response).toContain('too large')
      expect(response).toMatch(/connection: close/i)
    } finally { await host.close() }
  })

  it('keeps a connection reusable after a fully read body', async () => {
    const host = createHost({ plugins: [httpPlugin(), nodeHttpPlugin(), routesPlugin({ 'POST /': async (req) => ({ text: await req.raw().text() }) })] })
    await host.start()
    const agent = new Agent({ keepAlive: true, maxSockets: 1 })
    const send = (): Promise<boolean> => new Promise((resolve, reject) => {
      const client = request({ host: '127.0.0.1', port: port(host), method: 'POST', agent }, (response) => {
        let text = ''
        response.on('data', (chunk: Buffer) => { text += chunk.toString() })
        response.on('end', () => { expect(text).toBe('body'); resolve(client.reusedSocket) })
      })
      client.on('error', reject)
      client.end('body')
    })
    try { expect(await send()).toBe(false); expect(await send()).toBe(true) }
    finally { agent.destroy(); await host.close() }
  })

  it('errors an in-flight upload reader when the client disconnects', async () => {
    let entered = (): void => undefined
    const started = new Promise<void>((resolve) => { entered = resolve })
    let failed = (): void => undefined
    const error = new Promise<void>((resolve) => { failed = resolve })
    const host = createHost({ plugins: [httpPlugin(), nodeHttpPlugin(), routesPlugin({ 'POST /': async (req) => {
      entered()
      try { await req.raw().text() } catch { failed() }
      return { empty: true }
    } })] })
    await host.start()
    const socket = connect(port(host), '127.0.0.1')
    socket.write(`POST / HTTP/1.1\r\nHost: localhost:${port(host)}\r\nContent-Length: 99999\r\n\r\na`)
    await started
    socket.destroy()
    await error
    await host.close()
  })

  it.each(['handler', 'response'] as const)('bounds rejected uploads canceled during %s when the peer never reads', async (phase) => {
    let cancelled = (): void => undefined
    const cancellation = new Promise<void>((resolve) => { cancelled = resolve })
    const host = createHost({ plugins: [httpPlugin({ drainTimeoutMs: 50 }), nodeHttpPlugin(), routesPlugin({ 'POST /': (req) => {
      if (phase === 'handler') void req.raw().body?.cancel().catch(() => undefined)
      return { status: 413, raw: new ReadableStream({
        pull(controller) {
          if (phase === 'response') void req.raw().body?.cancel().catch(() => undefined)
          controller.enqueue(new Uint8Array(16 * 1024 * 1024))
        },
        cancel() { cancelled() },
      }, { highWaterMark: 0 }) }
    } })] })
    await host.start()
    const socket = connect(port(host), '127.0.0.1')
    socket.on('error', () => undefined)
    socket.pause()
    socket.write(`POST / HTTP/1.1\r\nHost: localhost:${port(host)}\r\nContent-Length: 99999\r\n\r\na`)
    try { await cancellation } finally { socket.destroy(); await host.close() }
  })

  it('settles upload readers and shares one shutdown budget with logical ingress', async () => {
    let entered = (): void => undefined
    const started = new Promise<void>((resolve) => { entered = resolve })
    let cancelled = false
    const host = createHost({ plugins: [httpPlugin({ drainTimeoutMs: 100 }), nodeHttpPlugin(), routesPlugin({ 'POST /': async (req) => {
      entered()
      try { await req.raw().text() } catch { cancelled = true }
      return { empty: true }
    } })] })
    await host.start()
    const socket = connect(port(host), '127.0.0.1')
    socket.on('error', () => undefined)
    socket.write(`POST / HTTP/1.1\r\nHost: localhost:${port(host)}\r\nContent-Length: 99999\r\n\r\na`)
    await started
    try {
      await host.close()
      expect(cancelled).toBe(true)
    } finally { socket.destroy() }
  })
})
