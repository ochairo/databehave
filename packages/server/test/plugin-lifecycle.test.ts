import { createHost, capability, type Host, type Plugin } from '@databehave/core'
import { request as nodeRequest } from 'node:http'
import { describe, expect, it } from 'vitest'
import { httpCapability, terminateTransport } from '../src/http.js'
import { nodeHttpPlugin, listenerCapability } from '../src/node-http.js'
import { httpPlugin } from '../src/server.js'
import { corsPlugin } from '../src/plugins/cors.js'
import { routesPlugin } from '../src/plugins/routes.js'

const url = (host: Host, path = '/item'): string => {
  const address = host.get(listenerCapability).address
  if (!address) throw new Error('Listener did not open')
  return `http://127.0.0.1:${address.port}${path}`
}

/** Use a real Node client without fetch retries or shared connection pooling. */
const send = (target: string, method = 'GET'): Promise<{ status: number; body: string; cors: string | string[] | undefined }> => new Promise((resolve, reject) => {
  const req = nodeRequest(target, { method, agent: false, ...(method === 'OPTIONS' ? { headers: { 'access-control-request-method': 'GET' } } : {}) }, (res) => {
    const chunks: Buffer[] = []
    res.on('data', (chunk: Buffer) => chunks.push(chunk))
    res.on('error', reject)
    res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString(), cors: res.headers['access-control-allow-origin'] }))
  })
  req.on('error', reject)
  req.end()
})

describe('HTTP plugin lifecycle and actual sockets', () => {
  it('runs common response behavior on real HTTP including HEAD and preflight', async () => {
    let handled = 0
    const host = createHost({ plugins: [nodeHttpPlugin(), corsPlugin(), httpPlugin(), routesPlugin({ 'GET /item': () => { handled++; return { text: 'body' } } })] })
    await host.start()
    try {
      expect(await send(url(host))).toMatchObject({ status: 200, body: 'body', cors: '*' })
      expect(await send(url(host), 'HEAD')).toMatchObject({ status: 200, body: '', cors: '*' })
      expect(await send(url(host), 'OPTIONS')).toMatchObject({ status: 204, body: '', cors: '*' })
      expect(handled).toBe(2)
    } finally { await host.close() }
    expect(host.get(listenerCapability).address).toBeUndefined()
  })

  it('destroys the actual socket for a transport termination', async () => {
    const host = createHost({ plugins: [httpPlugin(), nodeHttpPlugin(), routesPlugin({ 'GET /item': () => terminateTransport() })] })
    await host.start()
    try { await expect(send(url(host))).rejects.toMatchObject({ code: 'ECONNRESET' }) }
    finally { await host.close() }
  })

  it('executes bind guards before opening ingress', async () => {
    let guardCalled = false
    const guard: Plugin = { id: 'guard', apiVersion: 1, requires: [httpCapability], setup(ctx) {
      ctx.use(httpCapability).registerBindGuard({ owner: 'guard', check(bind) {
        guardCalled = true
        expect(bind.host).toBe('0.0.0.0')
        throw new Error('Loopback binding required')
      } })
    } }
    const host = createHost({ plugins: [nodeHttpPlugin({ host: '0.0.0.0' }), httpPlugin(), guard] })
    await expect(host.start()).rejects.toThrow('Loopback binding required')
    expect(guardCalled).toBe(true)
    expect(host.get(listenerCapability).address).toBeUndefined()
  })

  it('releases partial startup resources when the requested port is already bound', async () => {
    const first = createHost({ plugins: [httpPlugin(), nodeHttpPlugin()] })
    await first.start()
    try {
      const address = first.get(listenerCapability).address
      if (!address) throw new Error('First listener did not open')
      const second = createHost({ plugins: [httpPlugin(), nodeHttpPlugin({ port: address.port })] })
      await expect(second.start()).rejects.toMatchObject({ code: 'EADDRINUSE' })
      expect(second.get(listenerCapability).address).toBeUndefined()
      await second.close()
      expect((await send(url(first))).status).toBe(404)
    } finally { await first.close() }
  })

  it('aborts active request signals on close and bounds non-cooperating work', async () => {
    let started: (() => void) | undefined
    const entered = new Promise<void>((resolve) => { started = resolve })
    let aborted = false
    const host = createHost({ plugins: [httpPlugin({ drainTimeoutMs: 25 }), nodeHttpPlugin(), routesPlugin({ 'GET /item': (req) => {
      req.signal.addEventListener('abort', () => { aborted = true }, { once: true })
      started?.()
      return new Promise(() => { /* Deliberately uncooperative handler exercises the drain deadline. */ })
    } })] })
    await host.start()
    const pending = send(url(host)).then(() => 'response', () => 'closed')
    await entered
    const before = performance.now()
    await expect(host.close()).rejects.toThrow()
    expect(performance.now() - before).toBeLessThan(1000)
    expect(aborted).toBe(true)
    expect(await pending).toBe('closed')
  })

  it('cancels cooperative delay immediately when the client disconnects', async () => {
    let started: (() => void) | undefined
    const entered = new Promise<void>((resolve) => { started = resolve })
    let cancelled: (() => void) | undefined
    const cancellation = new Promise<void>((resolve) => { cancelled = resolve })
    const host = createHost({ plugins: [httpPlugin(), nodeHttpPlugin(), routesPlugin({ 'GET /item': async (req) => {
      started?.()
      await new Promise<void>((resolve) => {
        req.signal.addEventListener('abort', () => { cancelled?.(); resolve() }, { once: true })
      })
      return { empty: true }
    } })] })
    await host.start()
    try {
      const client = nodeRequest(url(host), { agent: false })
      client.on('error', () => undefined)
      client.end()
      await entered
      client.destroy()
      await cancellation
    } finally { await host.close() }
  })

  it('keeps stage order in original composition order despite dependency reordering', async () => {
    const dependency = capability<object>('test.later-provider')
    const calls: string[] = []
    const consumer: Plugin = { id: 'consumer', apiVersion: 1, requires: [httpCapability, dependency], setup(ctx) {
      ctx.use(httpCapability).registerMiddleware({ owner: 'consumer', order: ctx.order, stage: 'interception', handle() { calls.push('consumer') } })
    } }
    const provider: Plugin = { id: 'provider', apiVersion: 1, requires: [httpCapability], provides: [dependency], setup(ctx) {
      ctx.provide(dependency, {})
      ctx.use(httpCapability).registerMiddleware({ owner: 'provider', order: ctx.order, stage: 'interception', handle() { calls.push('provider') } })
    } }
    const host = createHost({ plugins: [consumer, provider, httpPlugin()] })
    await host.start()
    await host.get(httpCapability).fetch(new Request('http://localhost/item'))
    expect(calls).toEqual(['consumer', 'provider'])
    await host.close()
  })

  it('keeps independently composed hosts isolated', async () => {
    const first = createHost({ plugins: [httpPlugin(), routesPlugin({ 'GET /item': () => ({ text: 'first' }) })] })
    const second = createHost({ plugins: [httpPlugin()] })
    await Promise.all([first.start(), second.start()])
    expect((await first.get(httpCapability).fetch(new Request('http://localhost/item'))).status).toBe(200)
    expect((await second.get(httpCapability).fetch(new Request('http://localhost/item'))).status).toBe(404)
    await Promise.all([first.close(), second.close()])
  })
})
