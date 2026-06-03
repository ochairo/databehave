/**
 * Built-in mock-mode middleware.
 *
 * Selects an HTTP *status* per request and either short-circuits the
 * handler with a synthesized response of that status or lets it
 * through. All configuration is declarative — driven entirely by
 * `mockMode` in `databehave.json`.
 *
 * Resolution order per request (first hit wins):
 *   1. `pathOverrides["<METHOD> <path>"]`
 *   2. `pathOverrides["<path>"]`
 *   3. `defaultStatus`
 *   4. passthrough (real handler runs)
 *
 * Body resolution for a non-passthrough status N:
 *   1. status === 204                → empty body
 *   2. `bodyResolver(method, path, N)` returns a body
 *      (typically OpenAPI `responses[N]` schema mock)
 *   3. fallback envelope `{ error: true, status: N }`
 *
 * The header `x-mock-status` is always tagged on the final response
 * (configurable via `header`). Health paths bypass everything.
 */
import type { MockRequest, MockResponse } from './types.js'

export type BodyResolver = (
  method: string,
  path: string,
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

export interface MockModeConfig {
  /** Master switch. When `false` or absent, the feature is disabled. */
  enabled?: boolean
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
  config: MockModeConfig,
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
  config: MockModeConfig,
  bodyResolver?: BodyResolver,
): MockModeHooks | undefined => {
  if (config.enabled !== true) return undefined
  const header = config.header ?? 'x-mock-status'
  const healthPaths = new Set(config.healthPaths ?? [])
  const isHealthPath = (p: string): boolean => healthPaths.has(p)
  const logger: MockModeLogger = config.logger ?? console

  const synthesize = (
    method: string,
    path: string,
    status: number,
  ): MockResponse => {
    const headers = { [header]: String(status) }
    if (status === 204) {
      return { status, empty: true, headers }
    }
    const body = bodyResolver?.(method, path, status) ?? {
      error: true,
      status,
    }
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
          return synthesize(req.method, req.path, n)
        }
        // Out-of-range or non-numeric values were previously dropped on
        // the floor, which made debugging "why doesn't my override
        // work?" needlessly hard. Emit a single warn line so the typo
        // is visible without escalating to a hard failure (which would
        // break legitimate clients that ship the header for other
        // reasons).
        logger.warn(
          `@databehave/server/mock-mode: ignored ${header}=${JSON.stringify(raw)} ` +
            `(must be an integer in [200, 600))`,
        )
      }
    }
    const status = resolveStatus(req.method, req.path, config)
    if (status === undefined) return undefined
    return synthesize(req.method, req.path, status)
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
