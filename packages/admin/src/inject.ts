/** Fault interception; HTTP owns cancellation and terminal transport effects. */
import type {
  MockRequest,
  MockResponse,
} from '@databehave/server'

import type { OverridesStore } from './overrides-store.js'
import { parseHeaderMode } from './header-parser.js'
import type { ErrorMode } from './admin-types.js'
import { terminateTransport } from '@databehave/server'

const TAG_HEADER = 'x-mock-injected'

/** Header precedence, malformed input, or no applicable override. */
export type ResolveResult =
  | { kind: 'mode'; mode: ErrorMode; source: 'header' | 'sticky' }
  | { kind: 'error'; message: string }
  | { kind: 'none' }

/**
 * Pure resolver: header overrides beat sticky overrides. Returns
 * `'none'` when nothing applies and `'error'` for malformed headers.
 */
export const resolveMode = (
  store: Pick<OverridesStore, 'resolve'>,
  method: string,
  path: string,
  headers: Readonly<Record<string, string>>,
): ResolveResult => {
  const fromHeader = parseHeaderMode(headers)
  if (fromHeader.kind === 'error')
    return { kind: 'error', message: fromHeader.message }
  if (fromHeader.kind === 'mode') {
    return { kind: 'mode', mode: fromHeader.mode, source: 'header' }
  }
  const sticky = store.resolve(method, path)
  if (sticky) return { kind: 'mode', mode: sticky.mode, source: 'sticky' }
  return { kind: 'none' }
}

const buildResponse = (
  mode: ErrorMode,
  source: 'header' | 'sticky',
): MockResponse => {
  const tagHeaders: Record<string, string> = {
    [TAG_HEADER]: `${mode.kind}:${source}`,
  }
  switch (mode.kind) {
    case 'http-status':
      return {
        status: mode.status,
        json: { error: true, status: mode.status, injected: mode.kind },
        headers: tagHeaders,
      }
    case 'business-failure':
      return {
        status: 200,
        json: {
          success: false,
          message: mode.message,
          ...(mode.extra ?? {}),
        },
        headers: { ...tagHeaders, 'content-type': 'application/json' },
      }
    case 'custom-body': {
      const status = mode.status ?? 200
      const contentType = mode.contentType ?? 'application/json'
      if (typeof mode.body === 'string' && !contentType.includes('json')) {
        return {
          status,
          text: mode.body,
          headers: { ...tagHeaders, 'content-type': contentType },
        }
      }
      const payload =
        typeof mode.body === 'string' ? mode.body : JSON.stringify(mode.body)
      return {
        status,
        raw: payload,
        headers: { ...tagHeaders, 'content-type': contentType },
      }
    }
    case 'empty-body':
      return {
        status: mode.status ?? 204,
        empty: true,
        headers: tagHeaders,
      }
    case 'malformed-json':
      return {
        status: mode.status ?? 200,
        raw: '{',
        headers: { ...tagHeaders, 'content-type': 'application/json' },
      }
    /* v8 ignore start -- defensive: delay/hang/destroy never reach here */
    case 'delay':
    case 'hang':
    case 'destroy':
      // delay/hang are handled before this function; destroy is dispatched
      // through HTTP transport termination. Reaching here is a bug.
      return {
        status: 500,
        json: {
          error: true,
          message: `inject: ${mode.kind} should be handled before buildResponse`,
        },
        headers: tagHeaders,
      }
    /* v8 ignore stop */
  }
}

const buildDestroyDisabledResponse = (): MockResponse => ({
  status: 503,
  json: {
    error: 'x-mock-destroy disabled by faultInjectionPlugin allowDestroy:false',
  },
  headers: { [TAG_HEADER]: 'destroy-disabled' },
})

/** Interception policy and fault state supplied by the fault plugin. */
export interface InjectHookOptions {
  readonly store: Pick<OverridesStore, 'resolve'>
  readonly headers?: boolean
  /** Paths matching any of these prefixes are passed through (no injection). */
  readonly bypassPathPrefixes?: readonly string[]
  /** When false, destroy mode resolves to a 503 instead of dropping the socket. */
  readonly allowDestroy?: boolean
  readonly logger?: {
    warn(message: string): void
    info?(message: string): void
  }
}

export const createInjectHook = (opts: InjectHookOptions) => {
  const { store } = opts
  const bypass = opts.bypassPathPrefixes ?? ['/databehave']
  const allowDestroy = opts.allowDestroy !== false
  const logger = opts.logger ?? console

  const shouldBypass = (path: string): boolean =>
    bypass.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`))

  return async (
    req: MockRequest,
  ): Promise<MockResponse | void> => {
    if (shouldBypass(req.path)) return undefined

    const resolved = resolveMode(store, req.effectiveMethod, req.path, opts.headers === false ? {} : req.headers)
    if (resolved.kind === 'none') return undefined
    if (resolved.kind === 'error') {
      return {
        status: 400,
        json: { error: 'invalid x-mock-* header', detail: resolved.message },
        headers: { [TAG_HEADER]: 'header-error' },
      }
    }

    const { mode, source } = resolved

    if (mode.kind === 'hang') {
      await waitForFault(req.signal)
      return undefined
    }

    if (mode.kind === 'destroy') {
      if (!allowDestroy) {
        logger.warn(
          `[@databehave/admin] destroy requested on ${req.method} ${req.path} ` +
            `(source=${source}) but faultInjectionPlugin allowDestroy:false — responding 503.`,
        )
        return buildDestroyDisabledResponse()
      }
      return terminateTransport('Fault injection requested connection destruction')
    }

    if (mode.kind === 'delay') {
      await waitForFault(req.signal, mode.ms)
      if (mode.then === undefined) return undefined
      return buildResponse(mode.then, source)
    }

    return buildResponse(mode, source)
  }
}

/** Wait until the delay elapses or cancel immediately when HTTP aborts the request. */
const waitForFault = (signal: AbortSignal, ms?: number): Promise<void> => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return }
  let timer: ReturnType<typeof setTimeout> | undefined
  const abort = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    reject(signal.reason)
  }
  signal.addEventListener('abort', abort, { once: true })
  if (ms !== undefined) timer = setTimeout(() => {
    signal.removeEventListener('abort', abort)
    resolve()
  }, ms)
})
