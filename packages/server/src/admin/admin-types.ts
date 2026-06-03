/**
 * Admin-mode types & internal sentinel.
 *
 * `admin` is an opt-in extension of `Config` that
 * mounts an in-memory error-injection panel + `x-mock-*` headers
 * under a configurable mount path (default `/databehave`). See
 * {@link AdminModeConfig} on `Config.admin`.
 */

/**
 * Internal symbol attached to the response object returned by
 * {@link createInjectHook} when an `x-mock-destroy` is honored. The
 * kit's `server.listen()` http adapter recognizes this property and
 * drops the underlying socket without writing a response. Hidden
 * from {@link MockResponse} on purpose — destroy is not a
 * normal HTTP response shape.
 */
export const DESTROY_SOCKET_SENTINEL: unique symbol = Symbol.for(
  '@databehave/server:admin:destroy-socket',
)
export type DestroySocketSentinel = typeof DESTROY_SOCKET_SENTINEL

/**
 * Thrown internally by `server.fetch` when the admin inject hook
 * surfaced a {@link DESTROY_SOCKET_SENTINEL} response. `server.listen()`
 * catches it and destroys the socket; callers of `server.fetch()`
 * outside a listening server will observe the throw.
 */
export class AdminDestroySocketSignal extends Error {
  readonly name = 'AdminDestroySocketSignal'
  constructor() {
    super('@databehave/server: admin x-mock-destroy requested')
  }
}

/**
 * Discriminated union of every error mode the admin layer can inject.
 *   1. `http-status`        — non-2xx → typical HTTP error
 *   2. `business-failure`   — 2xx + `{success:false, message}`
 *   3. `custom-body`        — arbitrary status + arbitrary JSON / text
 *   4. `empty-body`         — empty body
 *   5. `malformed-json`     — body is literally `{` so JSON.parse blows up
 *   6. `delay`              — sleep `ms` then either run `then` or pass through
 *   7. `hang`               — never resolve (FE timeout / hang detection)
 *   8. `destroy`            — drop the socket without a response
 */
export type ErrorMode =
  | { kind: 'http-status'; status: number }
  | {
      kind: 'business-failure'
      message: string
      extra?: Record<string, unknown>
    }
  | {
      kind: 'custom-body'
      status?: number
      body: unknown
      contentType?: string
    }
  | { kind: 'empty-body'; status?: number }
  | { kind: 'malformed-json'; status?: number }
  | {
      kind: 'delay'
      ms: number
      then?: Exclude<
        ErrorMode,
        { kind: 'delay' } | { kind: 'hang' } | { kind: 'destroy' }
      >
    }
  | { kind: 'hang' }
  | { kind: 'destroy' }

/**
 * Resolution priority (handled by `OverridesStore.resolve`):
 *   1. `exact`  (METHOD + path)
 *   2. `path`   (path only, any method)
 *   3. `global` (every route)
 */
export type OverrideMatcher =
  | { kind: 'exact'; method: string; path: string }
  | { kind: 'path'; path: string }
  | { kind: 'global'; methods?: readonly string[] }

/** Alias kept for parity with the legacy reference; prefer {@link OverrideMatcher}. */
export type StickyMatcher = OverrideMatcher

export interface StickyOverride {
  readonly id: string
  readonly matcher: OverrideMatcher
  readonly mode: ErrorMode
  readonly createdAt: string
  readonly description?: string
}

/**
 * Admin-mode CORS policy.
 *
 *   - `'auto'`        — `'*'` when bind is loopback-only, `'same-origin'`
 *                       when `bind === 'any'` (defensive default for
 *                       LAN-exposed servers).
 *   - `'any'`         — `Access-Control-Allow-Origin: *`.
 *   - `'same-origin'` — no CORS headers added; browser enforces same-origin.
 *   - `{ origin }`    — explicit allowlist (string | string[]).
 */
export type AdminModeCors =
  | 'auto'
  | 'any'
  | 'same-origin'
  | { origin: string | readonly string[] }

/** Opt-in admin-mode configuration. All fields optional. */
export interface AdminModeConfig {
  /** Opt-in. Default: false. */
  enabled?: boolean
  /** Mount point for admin routes. Default: '/databehave'. Must start with '/'. */
  path?: string
  /** Serve the admin HTML page at `${path}` itself. Default: true when enabled. */
  ui?: boolean
  /** Honor `x-mock-*` request headers. Default: true when enabled. */
  headers?: boolean
  /**
   * Bind policy. 'loopback-only' (default) refuses to enable admin when
   * server.host resolves to a non-loopback address. 'any' allows it.
   */
  bind?: 'loopback-only' | 'any'
  /** Admin-route CORS — see {@link AdminModeCors}. Default: 'auto'. */
  cors?: AdminModeCors
  /** Allow `x-mock-destroy: 1` and the equivalent sticky. Default: true. */
  allowDestroy?: boolean
  /**
   * When `true`, the kit spawns the platform browser opener on the
   * resolved admin URL after `server.listen()` emits `listening`.
   * Default: `false` — the URL is logged to stdout (see the
   * `admin panel ready at …` banner) but no browser is launched.
   * Opt-in only; consumers who prefer to click the logged link, or
   * who run the kit in headless / CI environments, should leave this
   * unset. The CLI's `--open` flag is ORed with this field, so either
   * trigger launches the browser exactly once.
   */
  openBrowserOnStart?: boolean
  /**
   * Optional raw OpenAPI document body (JSON text) used to populate
   * the route picker in the UI. The CLI fills this in from the
   * config's `openapi` field; programmatic consumers can pass it
   * directly.
   */
  openapiBody?: string
  /**
   * Directory used to persist named scenarios (snapshots of the
   * current sticky overrides set). Default:
   * `<process.cwd()>/mock-scenarios`. The directory is created on
   * first write; a missing directory is treated as "no scenarios"
   * rather than an error.
   */
  scenariosDir?: string
}

/** A persisted scenario — a named bundle of sticky overrides. */
export interface Scenario {
  readonly name: string
  readonly overrides: readonly StickyOverride[]
  readonly created?: string
}

/** Lightweight scenario summary returned by the list endpoint. */
export interface ScenarioSummary {
  readonly name: string
  readonly count: number
  readonly created: string
}
