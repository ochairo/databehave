import { createHost, type Plugin } from '@databehave/core'
import { describe, expect, it } from 'vitest'
import { httpCapability, httpPlugin, routesPlugin } from '../src/index.js'

const deferred = () => {
  let resolve = (): void => undefined
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('logical HTTP ingress', () => {
  it('rejects dispatch during activation and after stop, before any handler', async () => {
    let calls = 0
    const probe: Plugin = { id: 'probe', apiVersion: 1, requires: [httpCapability], setup() {}, async activate(ctx) {
      await expect(ctx.use(httpCapability).fetch(new Request('http://local/'))).rejects.toThrow('not accepting')
    } }
    const host = createHost({ plugins: [httpPlugin(), probe, routesPlugin({ 'GET /': () => { calls++; return { empty: true } } })] })
    await host.start()
    const close = host.close()
    await expect(host.get(httpCapability).fetch(new Request('http://local/'))).rejects.toThrow()
    await close
    expect(calls).toBe(0)
  })

  it('waits for a cancelled handler to settle before disposing its dependency', async () => {
    const entered = deferred()
    const release = deferred()
    const aborted = deferred()
    let disposed = false
    const dependency: Plugin = { id: 'dependency', apiVersion: 1, setup() {}, activate(ctx) { ctx.defer(() => { disposed = true }) } }
    const host = createHost({ plugins: [httpPlugin(), dependency, routesPlugin({ 'GET /': async (request) => {
      request.signal.addEventListener('abort', aborted.resolve, { once: true })
      entered.resolve()
      await release.promise
      expect(disposed).toBe(false)
      return { empty: true }
    } })] })
    await host.start()
    const response = host.get(httpCapability).fetch(new Request('http://local/'))
    await entered.promise
    const close = host.close()
    await aborted.promise
    expect(disposed).toBe(false)
    release.resolve()
    await Promise.all([response, close])
    expect(disposed).toBe(true)
  })

  it.each(['caller', 'host', 'consumer'] as const)('retains response cancellation completion for %s', async (source) => {
    const cancelled = deferred()
    const release = deferred()
    let disposed = false
    let signal: AbortSignal | undefined
    const dependency: Plugin = { id: 'dependency', apiVersion: 1, setup() {}, activate(ctx) { ctx.defer(() => { disposed = true }) } }
    const host = createHost({ plugins: [httpPlugin(), dependency, routesPlugin({ 'GET /': (request) => {
      signal = request.signal
      return { raw: new ReadableStream({ cancel() { cancelled.resolve(); return release.promise } }) }
    } })] })
    await host.start()
    const caller = new AbortController()
    const response = await host.get(httpCapability).fetch(new Request('http://local/', { signal: caller.signal }))
    let cancellation: Promise<void> | undefined
    if (source === 'caller') caller.abort()
    if (source === 'consumer') cancellation = response.body?.cancel()
    const close = host.close()
    await cancelled.promise
    expect(disposed).toBe(false)
    expect(signal?.aborted).toBe(true)
    release.resolve()
    await Promise.all([close, cancellation])
    expect(disposed).toBe(true)
  })

  it('finishes normal EOF and stream errors, and cancels suppressed HEAD bodies', async () => {
    let cancelled = 0
    const host = createHost({ plugins: [httpPlugin(), routesPlugin({
      'GET /end': () => ({ text: 'complete' }),
      'GET /error': () => ({ raw: new ReadableStream({ pull(controller) { controller.error(new Error('stream failure')) } }) }),
      'GET /head': () => ({ raw: new ReadableStream({ cancel() { cancelled++ } }) }),
    })] })
    await host.start()
    const http = host.get(httpCapability)
    expect(await (await http.fetch(new Request('http://local/end'))).text()).toBe('complete')
    await expect((await http.fetch(new Request('http://local/error'))).text()).rejects.toThrow('stream failure')
    expect((await http.fetch(new Request('http://local/head', { method: 'HEAD' }))).body).toBeNull()
    expect(cancelled).toBe(1)
    await host.close()
  })

  it('reports an uncooperative body cancellation deadline', async () => {
    const release = deferred()
    const host = createHost({ plugins: [httpPlugin({ drainTimeoutMs: 10 }), routesPlugin({ 'GET /': () => ({ raw: new ReadableStream({ cancel: () => release.promise }) }) })] })
    await host.start()
    await host.get(httpCapability).fetch(new Request('http://local/'))
    try { await expect(host.close()).rejects.toThrow() } finally { release.resolve() }
  })

  it.each([-1, Infinity, NaN])('rejects invalid drain budget %s', (drainTimeoutMs) => {
    expect(() => httpPlugin({ drainTimeoutMs })).toThrow('drainTimeoutMs')
  })

  it('does not restart the budget after a preceding transport drain', async () => {
    const release = deferred()
    let transportFinished = 0
    const transport: Plugin = { id: 'transport', apiVersion: 1, requires: [httpCapability], setup() {}, open(ctx) {
      ctx.ownIngress({ stopAccepting() {}, async drainAndClose() {
        await new Promise<void>((resolve) => setTimeout(resolve, 80))
        transportFinished = performance.now()
      } })
    } }
    const host = createHost({ plugins: [httpPlugin({ drainTimeoutMs: 60 }), transport, routesPlugin({ 'GET /': () => ({ raw: new ReadableStream({ cancel: () => release.promise }) }) })] })
    await host.start()
    await host.get(httpCapability).fetch(new Request('http://local/'))
    try {
      await expect(host.close()).rejects.toThrow()
      expect(performance.now() - transportFinished).toBeLessThan(40)
    } finally { release.resolve() }
  })
})
