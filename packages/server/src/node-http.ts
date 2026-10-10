import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { capability, type Plugin } from '@databehave/core'
import { httpCapability, type HttpBind, type HttpRuntime } from './http.js'
import { InvalidHttpRequest, normalizeHostname, requestUrl } from './node-authority.js'
import { incomingBody, type IncomingBody } from './node-body.js'

/** Node listener configuration. Additional DNS authorities must be explicitly allowed. */
export interface NodeHttpOptions {
  readonly host?: string
  readonly port?: number
  readonly allowedHosts?: readonly string[]
  readonly onServerError?: (error: Error) => void
}

/** Listener address is unavailable until the open lifecycle phase has completed. */
export interface HttpListener {
  readonly address: HttpBind | undefined
}

export const listenerCapability = capability<HttpListener>('databehave.http.node-listener', 1)

/** Report listener failures without allowing a failing reporter to suppress the original error. */
export const handleRuntimeServerError = (error: Error, report: ((error: Error) => void) | undefined): void => {
  if (report) {
    try { report(error); return } catch (reportError) {
      // eslint-disable-next-line no-console
      console.error('HTTP error reporter failed:', reportError)
    }
  }
  // eslint-disable-next-line no-console
  console.error('HTTP server error:', error)
}

const handleRequest = async (http: HttpRuntime, incoming: IncomingMessage, outgoing: ServerResponse, signal: AbortSignal, bind: HttpBind, allowedHosts: readonly string[]): Promise<void> => {
  const controller = new AbortController()
  let body: IncomingBody | undefined
  const abort = (): void => { controller.abort(); body?.stop(controller.signal.reason) }
  let closing = false
  let closeConnection = false
  const closeAfterResponse = (): void => {
    if (closing) return
    closing = true
    closeConnection = true
    if (!outgoing.headersSent) outgoing.setHeader('connection', 'close')
    const socket = incoming.socket
    const timer = setTimeout(() => socket.destroy(), Math.max(0, (http.drainDeadline ?? performance.now() + http.drainTimeoutMs) - performance.now()))
    timer.unref()
    socket.once('close', () => clearTimeout(timer))
    outgoing.once('finish', () => socket.end())
  }
  const finish = (): Promise<void> => new Promise((resolve) => {
    if (closeConnection) { body?.stop(); closeAfterResponse() }
    if (outgoing.destroyed || outgoing.writableFinished) { resolve(); return }
    const done = (): void => { outgoing.off('finish', done); outgoing.off('close', done); resolve() }
    outgoing.once('finish', done)
    outgoing.once('close', done)
    outgoing.end()
  })
  signal.addEventListener('abort', abort, { once: true })
  incoming.once('aborted', abort)
  outgoing.once('close', abort)
  if (signal.aborted) abort()
  try {
    const url = requestUrl(incoming, bind, allowedHosts)
    const headers = new Headers()
    for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
      const name = incoming.rawHeaders[i]
      const value = incoming.rawHeaders[i + 1]
      if (name !== undefined && value !== undefined) headers.append(name, value)
    }
    const method = incoming.method ?? 'GET'
    const hasBody = method !== 'GET' && method !== 'HEAD'
    const init: RequestInit & { duplex?: 'half' } = { method, headers, signal: controller.signal }
    if (hasBody) {
      body = incomingBody(incoming)
      init.body = body.stream
      init.duplex = 'half'
      if (controller.signal.aborted) body.stop(controller.signal.reason)
    }
    const request = new Request(url, init)
    const outcome = await http.dispatch(request)
    if (outcome.kind === 'terminate') { incoming.socket.destroy(); return }
    if (outgoing.destroyed) { await outcome.response.body?.cancel(); return }
    outgoing.statusCode = outcome.response.status
    outcome.response.headers.forEach((value, name) => outgoing.setHeader(name, value))
    // Response pulls may still consume input after the handler returns.
    closeConnection = body ? !body.completed : !incoming.complete
    if (closeConnection) outgoing.setHeader('connection', 'close')
    body?.cancellation.addEventListener('abort', closeAfterResponse, { once: true })
    if (body?.cancellation.aborted) closeAfterResponse()
    if (!outcome.response.body) { await finish(); return }
    const reader = outcome.response.body.getReader()
    const cancelBody = (): void => { void reader.cancel().catch(() => undefined) }
    controller.signal.addEventListener('abort', cancelBody, { once: true })
    if (controller.signal.aborted) cancelBody()
    try {
      while (!controller.signal.aborted) {
        const chunk = await reader.read()
        if (chunk.done) break
        if (!outgoing.write(chunk.value)) {
          await new Promise<void>((resolve) => {
            const done = (): void => { outgoing.off('drain', done); outgoing.off('close', done); resolve() }
            outgoing.once('drain', done)
            outgoing.once('close', done)
          })
        }
      }
    } finally { controller.signal.removeEventListener('abort', cancelBody); await reader.cancel().catch(() => undefined) }
    await finish()
  } catch (error) {
    if (!outgoing.destroyed) {
      if (outgoing.headersSent) outgoing.destroy(error instanceof Error ? error : undefined)
      else {
        outgoing.statusCode = error instanceof InvalidHttpRequest ? error.status : 500
        closeAfterResponse()
        outgoing.write(error instanceof InvalidHttpRequest ? error.message : 'Internal Server Error')
        await finish()
      }
    }
  } finally {
    body?.cancellation.removeEventListener('abort', closeAfterResponse)
    body?.stop()
    signal.removeEventListener('abort', abort)
    incoming.off('aborted', abort)
    outgoing.off('close', abort)
  }
}

/** Open Node ingress only after all activation and bind policy checks have succeeded. */
export const nodeHttpPlugin = (options: NodeHttpOptions = {}): Plugin => {
  const bind = Object.freeze({ host: options.host ?? '127.0.0.1', port: options.port ?? 0 })
  const allowedHosts = Object.freeze((options.allowedHosts ?? []).map(normalizeHostname))
  let address: HttpBind | undefined
  return {
    id: 'databehave.http.node-listener', apiVersion: 1,
    requires: [httpCapability], provides: [listenerCapability],
    setup(ctx) { ctx.provide(listenerCapability, { get address() { return address } }) },
    async activate(ctx) { await ctx.use(httpCapability).checkBind(bind) },
    async open(ctx) {
      const http = ctx.use(httpCapability)
      const sockets = new Set<Socket>()
      const server = createServer((incoming, outgoing) => { void handleRequest(http, incoming, outgoing, ctx.signal, bind, allowedHosts) })
      server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
      const listening = new AbortController()
      let stopped = false
      let resolveClosed: (() => void) | undefined
      const closed = new Promise<void>((resolve) => { resolveClosed = resolve })
      const stopAccepting = (): void => {
        if (stopped) return
        stopped = true
        server.close(() => { address = undefined; resolveClosed?.() })
        server.closeIdleConnections()
        listening.abort()
      }
      ctx.ownIngress({
        stopAccepting,
        async drainAndClose() {
          stopAccepting()
          const timer = setTimeout(() => { for (const socket of sockets) socket.destroy() }, Math.max(0, (http.drainDeadline ?? performance.now() + http.drainTimeoutMs) - performance.now()))
          try { await closed } finally { clearTimeout(timer) }
        },
      })
      await new Promise<void>((resolve, reject) => {
        const removeStartupListeners = (): void => {
          server.off('error', onError)
          server.off('listening', onListening)
          listening.signal.removeEventListener('abort', onAbort)
        }
        const onError = (error: Error): void => { removeStartupListeners(); reject(error) }
        const onListening = (): void => { removeStartupListeners(); resolve() }
        const onAbort = (): void => { removeStartupListeners(); reject(new Error('HTTP listener closed during startup')) }
        server.once('error', onError)
        server.once('listening', onListening)
        listening.signal.addEventListener('abort', onAbort, { once: true })
        server.listen({ ...bind, signal: listening.signal })
      })
      const bound = server.address()
      if (!bound || typeof bound === 'string') throw new Error('Node HTTP listener did not return a TCP address')
      address = Object.freeze({ host: bound.address, port: bound.port })
      server.on('error', (error) => handleRuntimeServerError(error, options.onServerError))
    },
  }
}
