/** Explicit status selection and response tagging policy. */
import type { MockRequest, MockResponse } from '@databehave/server'

/** Optional generated body lookup for a selected route and status. */
export type BodyResolver = (
  request: MockRequest,
  status: number,
) => unknown | undefined

/**
 * Minimal logger interface (compatible with the host server's logger
 * and with `console`). Only `warn` is required by mock-mode today; the
 * shape is kept narrow so callers can pass an existing logger without
 * adapter glue.
 */
export interface MockModeLogger {
  warn(message: string): void
}

/** Status policy enabled by including the mock-mode plugin. */
export interface MockModeOptions {
  /** MockResponse header that tags every response with the resolved status. */
  header?: string
  /**
   * When `true`, an incoming request may force the mocked status by
   * sending the same header (default `x-mock-status: 500`). Disabled
   * by default so production-style mock servers don't expose status
   * injection to arbitrary clients. Resolution becomes:
   *   1. request `header` value (when `allowHeaderOverride === true`)
   *   2. `pathOverrides["<METHOD> <path>"]`
   *   3. `pathOverrides["<path>"]`
   *   4. `defaultStatus`
   *   5. passthrough
   */
  allowHeaderOverride?: boolean
  /** Paths exempt from status injection (typically health probes). */
  healthPaths?: readonly string[]
  /**
   * Status applied when no `pathOverrides` entry matches. Omit (or set
   * `undefined`) for passthrough (real handler runs). Set to an error
   * code (e.g. `500`) to force every route to that status by default.
   */
  defaultStatus?: number
  /**
   * Per-route status overrides. Keys use one of:
   *   - `"<METHOD> <path>"` (e.g. `"GET /api/v1/x"`) — method-scoped
   *   - `"<path>"`          (e.g. `"/api/v1/x"`)     — any method
   * Paths must be absolute (start with `/`). Values are HTTP status codes.
   */
  pathOverrides?: Record<string, number>
  /**
   * Logger used for non-fatal diagnostics (e.g. out-of-range header
   * overrides). Defaults to the global `console`. Pass the host
   * application's logger to keep mock-server output in one place
   * instead of leaking to stdout/stderr.
   */
  logger?: MockModeLogger
}

/** Interception and decoration callbacks for the HTTP middleware stages. */
export interface MockModeHooks {
  onRequest: (req: MockRequest) => MockResponse | undefined
  onResponse: (req: MockRequest, res: MockResponse) => MockResponse
}

/**
 * Resolve the status code for a request using only the supplied config.
 * Returns `undefined` when the request should pass through.
 * Exported for unit-testing; callers normally use `buildMockModeHooks`.
 */
export const resolveStatus = (
  method: string,
  path: string,
  config: MockModeOptions,
): number | undefined => {
  const overrides = config.pathOverrides ?? {}
  const m = method.toUpperCase()
  const byMethodPath = overrides[`${m} ${path}`]
  if (byMethodPath !== undefined) return byMethodPath
  const byPath = overrides[path]
  if (byPath !== undefined) return byPath
  return config.defaultStatus
}

/**
 * Build the onRequest / onResponse hook pair. Returns `undefined`
 * when the feature is disabled (caller may skip wiring entirely).
 *
 * `bodyResolver` is optional. When provided, @databehave/server asks it for a
 * body for the configured status (typically a generator backed by
 * the OpenAPI `responses[N]` schema). When it returns `undefined`,
 * the minimal envelope `{ error: true, status: N }` is used instead.
 */
export const buildMockModeHooks = (
  config: MockModeOptions & { readonly enabled?: boolean },
  bodyResolver?: BodyResolver,
): MockModeHooks | undefined => {
  if (config.enabled !== true) return undefined
  const header = config.header ?? 'x-mock-status'
  const healthPaths = new Set(config.healthPaths ?? [])
  const isHealthPath = (p: string): boolean => healthPaths.has(p)
  const logger: MockModeLogger = config.logger ?? console

  const synthesize = (
    request: MockRequest,
    status: number,
  ): MockResponse => {
    const headers = { [header]: String(status) }
    if (status === 204 || status === 205 || status === 304) {
      return { status, empty: true, headers }
    }
    const resolved = bodyResolver?.(request, status)
    const body = resolved === undefined ? { error: true, status } : resolved
    return { status, json: body, headers }
  }

  const onRequest = (req: MockRequest): MockResponse | undefined => {
    if (isHealthPath(req.path)) return undefined
    // Header override (opt-in). The header name is the same one used
    // to tag responses so a single curl flag flips both directions.
    // 1xx (informational) responses are rejected: Node's HTTP layer
    // treats them specially and a mock server has no use for them.
    if (config.allowHeaderOverride === true) {
      const raw = req.headers[header.toLowerCase()]
      if (raw !== undefined) {
        const n = Number.parseInt(raw, 10)
        if (Number.isFinite(n) && n >= 200 && n < 600) {
          return synthesize(req, n)
        }
        // Out-of-range or non-numeric values were previously dropped on
        // the floor, which made debugging "why doesn't my override
        // work?" needlessly hard. Emit a single warn line so the typo
        // is visible without escalating to a hard failure (which would
        // break legitimate clients that ship the header for other
        // reasons).
        logger.warn(
          `@databehave/openapi/mock-mode: ignored ${header}=${JSON.stringify(raw)} ` +
            `(must be an integer in [200, 600))`,
        )
      }
    }
    const status = resolveStatus(req.method, req.path, config)
    if (status === undefined) return undefined
    return synthesize(req, status)
  }

  const onResponse = (
    req: MockRequest,
    res: MockResponse,
  ): MockResponse => {
    if (isHealthPath(req.path)) return res
    // Skip when the response (synthesised or handler-supplied) already
    // carries the tag header. Header lookup is case-insensitive so
    // `'X-Mock-Status'` from a handler is recognised against the
    // configured (typically lowercase) `header` name.
    if (res.headers) {
      const wanted = header.toLowerCase()
      for (const k of Object.keys(res.headers)) {
        if (k.toLowerCase() === wanted) return res
      }
    }
    const tag = String(res.status ?? 200)
    return {
      ...res,
      headers: { ...(res.headers ?? {}), [header]: tag },
    }
  }

  return { onRequest, onResponse }
}
