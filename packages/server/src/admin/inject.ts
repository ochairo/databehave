/**
 * onRequest hook that consults `x-mock-*` headers + sticky overrides
 * and produces a `MockResponse` short-circuit. Header-derived
 * modes always beat sticky modes (per-request scoping > sticky rules).
 *
 * Modes handled directly here:
 *   - http-status, business-failure, custom-body, empty-body,
 *     malformed-json, delay (recursive), hang
 *
 * `destroy` is signalled via a sentinel response (see
 * {@link DESTROY_SOCKET_SENTINEL}) so the kit's `server.listen()` http
 * adapter can drop the socket without writing a body. When
 * `allowDestroy: false`, destroy resolves to a normal 503 response
 * instead.
 */
import type {
  MockRequest,
  MockResponse,
} from '../types.js'

import type { OverridesStore } from './overrides-store.js'
import { parseHeaderMode } from './header-parser.js'
import { DESTROY_SOCKET_SENTINEL, type ErrorMode } from './admin-types.js'

const TAG_HEADER = 'x-mock-injected'

export type ResolveResult =
  | { kind: 'mode'; mode: ErrorMode; source: 'header' | 'sticky' }
  | { kind: 'error'; message: string }
  | { kind: 'none' }

/**
 * Pure resolver: header overrides beat sticky overrides. Returns
 * `'none'` when nothing applies and `'error'` for malformed headers.
 */
export const resolveMode = (
  store: OverridesStore,
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
      // through the sentinel branch. Reaching here is a bug.
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
    error: 'x-mock-destroy disabled by admin.allowDestroy:false',
  },
  headers: { [TAG_HEADER]: 'destroy-disabled' },
})

/**
 * Sentinel response: shaped as a normal empty 204 so anything that
 * inspects the public type sees a valid response, but tagged with
 * {@link DESTROY_SOCKET_SENTINEL} so `server.listen()` can drop the
 * socket instead of writing the body.
 */
const buildDestroySentinel = (): MockResponse => {
  const base: MockResponse = {
    status: 204,
    empty: true,
    headers: { [TAG_HEADER]: 'destroy' },
  }
  Object.defineProperty(base, DESTROY_SOCKET_SENTINEL, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  })
  return base
}

export interface InjectHookOptions {
  readonly store: OverridesStore
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
    bypass.some((p) => path.startsWith(p))

  return async (
    req: MockRequest,
  ): Promise<MockResponse | void> => {
    if (shouldBypass(req.path)) return undefined

    const resolved = resolveMode(store, req.method, req.path, req.headers)
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
      logger.warn(
        `[@databehave/server/admin] hang triggered on ${req.method} ${req.path} ` +
          `(source=${source}) — request will never resolve; close the client to recover.`,
      )
      /* v8 ignore start -- promise never resolves; return is unreachable */
      await new Promise<never>(() => {
        /* never resolves */
      })
      return undefined
      /* v8 ignore stop */
    }

    if (mode.kind === 'destroy') {
      if (!allowDestroy) {
        logger.warn(
          `[@databehave/server/admin] destroy requested on ${req.method} ${req.path} ` +
            `(source=${source}) but admin.allowDestroy:false — responding 503.`,
        )
        return buildDestroyDisabledResponse()
      }
      return buildDestroySentinel()
    }

    if (mode.kind === 'delay') {
      await new Promise((r) => setTimeout(r, mode.ms))
      if (mode.then === undefined) return undefined
      return buildResponse(mode.then, source)
    }

    return buildResponse(mode, source)
  }
}

/** True when the response carries the internal destroy-socket sentinel. */
export const isDestroySocketSentinel = (
  res: MockResponse | undefined | null,
): boolean => {
  if (!res) return false
  return (res as Record<symbol, unknown>)[DESTROY_SOCKET_SENTINEL] === true
}
