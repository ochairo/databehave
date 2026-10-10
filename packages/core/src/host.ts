import type { Host, HostState, IngressHandle, LifecycleContext, Plugin } from './contracts.js'
import { register } from './registration.js'

/** Validate, register and seal plugins synchronously, without starting their effects. */
export function createHost(options: { readonly plugins: readonly Plugin[] }): Host {
  const registration = register(options.plugins)
  const lifetime = new AbortController()
  const disposers: (() => void | Promise<void>)[] = []
  const ingress: IngressHandle[] = []
  const stopped = new Set<IngressHandle>()
  const cleanupErrors: unknown[] = []
  let state: HostState = 'ready'
  let startPromise: Promise<void> | undefined
  let execution: Promise<void> | undefined
  let closePromise: Promise<void> | undefined
  let failed = false
  let startupError: unknown
  let closing = false

  function stopAccepting(handle: IngressHandle): void {
    if (stopped.has(handle)) return
    stopped.add(handle)
    try { handle.stopAccepting() } catch (error) { cleanupErrors.push(error) }
  }

  function beginClose(): void {
    closing = true
    state = 'closing'
    for (const handle of ingress) stopAccepting(handle)
    lifetime.abort()
  }

  async function cleanup(): Promise<void> {
    // A completing hook still owns its context, and can register a newly acquired resource.
    try { await execution } catch { /* Startup failure is retained separately. */ }
    for (const handle of [...ingress].reverse()) {
      try { await handle.drainAndClose() } catch (error) { cleanupErrors.push(error) }
    }
    for (const dispose of disposers.reverse()) {
      try { await dispose() } catch (error) { cleanupErrors.push(error) }
    }
    state = failed || cleanupErrors.length ? 'failed' : 'closed'
    if (cleanupErrors.length) {
      throw new AggregateError(failed ? [startupError, ...cleanupErrors] : cleanupErrors, 'Host cleanup failed',
        failed ? { cause: startupError } : undefined)
    }
  }

  function close(): Promise<void> {
    if (!closePromise) {
      // Schedule cleanup after installing the shared promise, before invoking plugin callbacks.
      closePromise = Promise.resolve().then(cleanup)
      beginClose()
    }
    return closePromise
  }

  async function run(): Promise<void> {
    for (const phase of ['prepare', 'activate', 'open'] as const) {
      for (const owner of registration.ordered) {
        if (closing) return
        const hook = owner.plugin[phase]
        if (!hook) continue
        let active = true
        function assertActive(): void {
          if (!active) throw new Error(`Lifecycle context expired for ${owner.plugin.id}:${phase}`)
        }
        const context: LifecycleContext = {
          order: owner.order,
          signal: lifetime.signal,
          use(token) {
            assertActive()
            return registration.use(owner, token)
          },
          defer(dispose): void {
            assertActive()
            if (typeof dispose !== 'function') throw new Error('Disposer must be a function')
            disposers.push(dispose)
          },
          ownIngress(handle): void {
            assertActive()
            if (phase !== 'open') throw new Error('Ingress may only be acquired during open')
            if (!handle || typeof handle.stopAccepting !== 'function' || typeof handle.drainAndClose !== 'function') {
              throw new Error('Invalid ingress handle')
            }
            if (ingress.includes(handle)) throw new Error('Ingress handle already owned')
            ingress.push(handle)
            if (closing) stopAccepting(handle)
          },
        }
        try { await hook.call(owner.plugin, context) } finally { active = false }
      }
    }
  }

  function start(): Promise<void> {
    if (!startPromise) {
      if (closing) {
        startPromise = Promise.reject(new Error('Cannot start a closed host'))
      } else {
        state = 'starting'
        execution = Promise.resolve().then(run).catch((error: unknown) => {
          failed = true
          startupError = error
          throw error
        })
        startPromise = execution.then(async () => {
          if (closing) {
            await close()
            throw new Error('Host closed during startup')
          }
          state = 'running'
        }, async (error: unknown) => {
          await close()
          throw error
        })
      }
    }
    return startPromise
  }

  return { start, close, get: registration.get, get state() { return state } }
}
