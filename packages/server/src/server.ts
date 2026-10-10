import type { Plugin } from '@databehave/core'
import {
  httpCapability,
  HttpTransportTermination,
  UnsupportedTransportError,
  type BindGuard,
  type HttpMiddleware,
  type HttpOutcome,
  type HttpRuntime,
  type ResolvedRoute,
  type RouteSource,
} from './http.js'
import { buildRequest } from './request.js'
import { buildResponse } from './response.js'
import { matchPattern, parseRouteKey, parseRoutePattern, type RoutePattern } from './route-key.js'
import type { MockRequest, MockResponse, ObservedMethod } from './types.js'

/** An indexed route retains its contribution's composition position for deterministic ties. */
interface IndexedRoute {
  readonly route: ResolvedRoute
  readonly pattern: RoutePattern
}

const genericError = (): MockResponse => ({ status: 500, json: { error: 'internal_error', message: 'Internal server error' } })

/** Shutdown budget shared by logical requests and optional transports. */
export interface HttpOptions {
  readonly drainTimeoutMs?: number
}

/** Provide an instance-local HTTP pipeline; no listener or feature is installed implicitly. */
export const httpPlugin = (options: HttpOptions = {}): Plugin => {
  const drainTimeoutMs = options.drainTimeoutMs ?? 1000
  if (!Number.isFinite(drainTimeoutMs) || drainTimeoutMs < 0) throw new Error('drainTimeoutMs must be a finite non-negative number')
  let drainDeadline: number | undefined
  let accepting = false
  const pending = new Set<Promise<void>>()
  const sources: RouteSource[] = []
  const middleware: HttpMiddleware[] = []
  const guards: BindGuard[] = []
  let sealed = false
  let active = false
  let lifetime: AbortSignal | undefined
  let routes: readonly ResolvedRoute[] = Object.freeze([])
  let indexed: readonly IndexedRoute[] = []
  const exact = new Map<string, ResolvedRoute>()
  const assertRegistration = (): void => {
    if (sealed) throw new Error('HTTP registration is sealed')
  }
  const assertActive = (): void => {
    if (!active) throw new Error('HTTP runtime has not activated')
    if (lifetime?.aborted) throw lifetime.reason
  }
  const findRoute = (method: string, path: string): { route: ResolvedRoute; params: Readonly<Record<string, string>> } | undefined => {
    const route = exact.get(`${method} ${path}`)
    if (route) return { route, params: Object.create(null) as Record<string, string> }
    for (const entry of indexed) {
      if (entry.route.method !== method) continue
      const params = matchPattern(entry.pattern, path)
      if (params) return { route: entry.route, params }
    }
    return undefined
  }
  const suppressHead = async (response: Response, method: string): Promise<Response> => {
    if (method !== 'head') return response
    await response.body?.cancel()
    return new Response(null, { status: response.status, headers: response.headers })
  }
  const handleError = async (request: MockRequest, error: unknown): Promise<MockResponse> => {
    for (const entry of middleware) {
      if (entry.stage !== 'error') continue
      try {
        const response = await entry.handle(request, error)
        if (response) return response
      } catch {
        return genericError()
      }
    }
    return genericError()
  }
  const execute = async (raw: Request): Promise<HttpOutcome> => {
    const started = performance.now()
    const method = raw.method.toLowerCase() as ObservedMethod
    const path = new URL(raw.url).pathname
    const matched = findRoute(method, path) ?? (method === 'head' ? findRoute('get', path) : undefined)
    const request = buildRequest(raw, matched?.params, matched?.route.method ?? method)
    let error: unknown
    let outcome: HttpOutcome | undefined
    let response: MockResponse | undefined
    try {
      for (const stage of ['preflight', 'validation', 'interception'] as const) {
        for (const entry of middleware) {
          if (entry.stage !== stage) continue
          const result = await entry.handle(request)
          if (result) { response = result; break }
        }
        if (response) break
      }
      response ??= matched ? await matched.route.handler(request) : { status: 404, json: { error: 'not_found', method: request.method, path: request.path } }
    } catch (caught) {
      error = caught
      if (caught instanceof HttpTransportTermination) outcome = { kind: 'terminate', reason: caught.message }
      else response = await handleError(request, caught)
    }
    if (!outcome) {
      try {
        let decorated = response ?? genericError()
        for (const entry of middleware) {
          if (entry.stage !== 'decoration') continue
          decorated = await entry.handle(request, decorated) ?? decorated
        }
        const webResponse = buildResponse(decorated)
        outcome = { kind: 'response', response: await suppressHead(webResponse, method) }
      } catch (caught) {
        error = caught
        if (caught instanceof HttpTransportTermination) outcome = { kind: 'terminate', reason: caught.message }
        else {
          let fallback: Response
          try { fallback = buildResponse(await handleError(request, caught)) }
          catch { fallback = buildResponse(genericError()) }
          outcome = { kind: 'response', response: await suppressHead(fallback, method) }
        }
      }
    }
    const observation = { request, outcome, durationMs: performance.now() - started, ...(error === undefined ? {} : { error }) }
    for (const entry of middleware) {
      if (entry.stage !== 'observation') continue
      try { await entry.handle(observation) } catch { /* Observers cannot change the terminal outcome. */ }
    }
    return outcome
  }
  const runtime: HttpRuntime = {
    get drainTimeoutMs() { return drainTimeoutMs },
    get drainDeadline() { return drainDeadline },
    registerRoutes(source) {
      assertRegistration()
      if (!source.owner || !Number.isFinite(source.order)) throw new Error('HTTP route source requires an owner and finite composition order')
      sources.push(Object.freeze({ ...source }))
    },
    registerMiddleware(entry) {
      assertRegistration()
      if (!entry.owner || !Number.isFinite(entry.order)) throw new Error('HTTP middleware requires an owner and finite composition order')
      middleware.push(Object.freeze({ ...entry }))
    },
    registerBindGuard(guard) { assertRegistration(); guards.push(Object.freeze({ ...guard })) },
    get routes() {
      if (!active) throw new Error('HTTP route catalog is unavailable before activation')
      return routes
    },
    resolveRoute(method, path) {
      assertActive()
      const normalized = method.toLowerCase()
      return (findRoute(normalized, path) ?? (normalized === 'head' ? findRoute('get', path) : undefined))?.route
    },
    async checkBind(bind) { for (const guard of guards) await guard.check(bind) },
    async dispatch(request) {
      assertActive()
      if (!accepting) throw new Error('HTTP runtime is not accepting requests')
      request.signal.throwIfAborted()
      const controller = new AbortController()
      const abortRequest = (): void => controller.abort(request.signal.reason)
      const abortLifetime = (): void => controller.abort(lifetime?.reason)
      request.signal.addEventListener('abort', abortRequest, { once: true })
      lifetime?.addEventListener('abort', abortLifetime, { once: true })
      let resolveDone: () => void = () => undefined
      const done = new Promise<void>((resolve) => { resolveDone = resolve })
      pending.add(done)
      const finish = (): void => {
        pending.delete(done)
        resolveDone()
        request.signal.removeEventListener('abort', abortRequest)
        lifetime?.removeEventListener('abort', abortLifetime)
      }
      try {
        const outcome = await execute(new Request(request, { signal: controller.signal }))
        if (outcome.kind !== 'response' || !outcome.response.body) { finish(); return outcome }
        const reader = outcome.response.body.getReader()
        let stopped = false
        let cancellation: Promise<void> | undefined
        let output: ReadableStreamDefaultController<Uint8Array>
        const complete = (): void => {
          controller.signal.removeEventListener('abort', abortBody)
          reader.releaseLock()
          finish()
        }
        const cancel = (reason: unknown): Promise<void> => {
          if (cancellation) return cancellation
          stopped = true
          cancellation = reader.cancel(reason).finally(complete)
          return cancellation
        }
        const abortBody = (): void => {
          if (stopped) return
          output.error(controller.signal.reason)
          void cancel(controller.signal.reason).catch(() => undefined)
        }
        const body = new ReadableStream<Uint8Array>({
          start(stream) { output = stream },
          async pull(stream) {
            try {
              const chunk = await reader.read()
              if (stopped) return
              if (chunk.done) { stopped = true; stream.close(); complete() }
              else stream.enqueue(chunk.value)
            } catch (error) {
              if (!stopped) { stopped = true; stream.error(error); complete() }
            }
          },
          cancel,
        }, { highWaterMark: 0 })
        controller.signal.addEventListener('abort', abortBody, { once: true })
        if (controller.signal.aborted) abortBody()
        return { kind: 'response', response: new Response(body, { status: outcome.response.status, statusText: outcome.response.statusText, headers: outcome.response.headers }) }
      } catch (error) { finish(); throw error }
    },
    async fetch(request) {
      const outcome = await runtime.dispatch(request)
      if (outcome.kind === 'terminate') throw new UnsupportedTransportError(outcome.reason)
      return outcome.response
    },
  }
  return {
    id: 'databehave.http', apiVersion: 1, provides: [httpCapability],
    setup(ctx) {
      ctx.provide(httpCapability, runtime)
      ctx.onSeal(() => {
        sealed = true
        sources.sort((a, b) => a.order - b.order)
        middleware.sort((a, b) => a.order - b.order)
      })
    },
    activate(ctx) {
      lifetime = ctx.signal
      const resolved = new Map<string, ResolvedRoute>()
      for (const source of sources) {
        for (const definition of source.materialize()) {
          const { method, path } = parseRouteKey(definition.key)
          parseRoutePattern(path)
          const key = `${method} ${path}`
          const previous = resolved.get(key)
          if (previous?.priority === definition.priority) {
            throw new Error(`Duplicate HTTP route ${definition.key}: ${previous.owner} and ${source.owner}`)
          }
          if (previous?.priority === 'explicit') continue
          resolved.delete(key)
          resolved.set(key, Object.freeze({ ...definition, owner: source.owner, method, path }))
        }
      }
      routes = Object.freeze([...resolved.values()])
      indexed = routes.flatMap((route) => {
        const pattern = parseRoutePattern(route.path)
        if (!pattern.isStatic) return [{ route, pattern }]
        exact.set(`${route.method} ${route.path}`, route)
        return []
      })
      active = true
      ctx.defer(() => { active = false })
    },
    open(ctx) {
      accepting = true
      const stopAccepting = (): void => {
        accepting = false
        drainDeadline ??= performance.now() + drainTimeoutMs
      }
      ctx.ownIngress({
        stopAccepting,
        async drainAndClose() {
          stopAccepting()
          if (!pending.size) return
          let timer: ReturnType<typeof setTimeout> | undefined
          try {
            await Promise.race([
              Promise.all([...pending]),
              new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`HTTP drain timed out with ${pending.size} unfinished request(s)`)), Math.max(0, (drainDeadline ?? 0) - performance.now()))
              }),
            ])
          } finally { clearTimeout(timer) }
        },
      })
    },
  }
}
