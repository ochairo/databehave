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

/** A normalized override snapshot; mutation belongs to the fault-control capability. */
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

/** A persisted scenario — a named bundle of sticky overrides. */
export interface Scenario {
  readonly version?: 1
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
