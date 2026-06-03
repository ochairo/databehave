/**
 * CORS helpers — pure, framework-agnostic.
 *
 * Two concerns:
 *
 * 1. **Preflight (`OPTIONS`)** — answered up-front in the request
 *    pipeline so handlers never see it.
 * 2. **Response decoration** — `Access-Control-*` headers are added
 *    to every other response in the pipeline.
 *
 * Defaults match the legacy mock server's Hono CORS config so the
 * migration stays backwards-compatible:
 * - origin: mirror request `Origin`, or `*` when absent
 * - credentials: header omitted by default; set `credentials: true` in
 *   `Config.cors` to send `Access-Control-Allow-Credentials: true`
 */
import type { CorsConfig, MockRequest, MockResponse } from './types.js'

const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
const DEFAULT_HEADERS = ['content-type', 'authorization']

const resolveOrigin = (cfg: CorsConfig, reqOrigin: string): string => {
  if (cfg.origin) return cfg.origin(reqOrigin)
  return reqOrigin === '' ? '*' : reqOrigin
}

/**
 * Merge two `Vary` header values, deduplicating tokens
 * case-insensitively while preserving the first occurrence's casing.
 * `Vary: *` short-circuits to `*` (HTTP semantic: “varies on every
 * possible header”, no further tokens add information).
 *
 * Exported so server-level decorators (and tests) can compose the
 * CORS `Vary` onto whatever the handler already declared.
 */
export const mergeVary = (existing: string | undefined, additional: string): string => {
  if (!existing) return additional
  const seen = new Map<string, string>()
  for (const raw of [existing, additional]) {
    for (const tok of raw.split(',')) {
      const t = tok.trim()
      if (t === '') continue
      if (t === '*') return '*'
      const key = t.toLowerCase()
      if (!seen.has(key)) seen.set(key, t)
    }
  }
  return Array.from(seen.values()).join(', ')
}

/**
 * Build the `Access-Control-*` header bag for a non-preflight
 * response.
 *
 * - `Access-Control-Allow-Origin` is omitted when the resolved origin
 *   is an empty string (browsers reject empty header values, and an
 *   empty header is the de-facto “reject” signal anyway).
 * - `Vary: Origin` is always added when CORS is enabled so reverse
 *   proxies and CDNs don't cache one origin's response and serve it
 *   to another. The server-level decorator merges this token with
 *   any handler-supplied `Vary` (see {@link mergeVary}).
 */
export const buildCorsResponseHeaders = (
  cfg: CorsConfig,
  req: MockRequest,
): Record<string, string> => {
  const headers: Record<string, string> = {}
  const reqOrigin = req.headers['origin'] ?? ''
  const allowed = resolveOrigin(cfg, reqOrigin)
  if (allowed !== '') {
    headers['access-control-allow-origin'] = allowed
  }
  headers['vary'] = 'Origin'
  if (cfg.credentials) headers['access-control-allow-credentials'] = 'true'
  if (cfg.exposeHeaders && cfg.exposeHeaders.length > 0) {
    headers['access-control-expose-headers'] = cfg.exposeHeaders.join(', ')
  }
  return headers
}

/**
 * Intersect the browser's `Access-Control-Request-Headers` with the
 * configured allowlist. Returns a comma-separated header value.
 *
 * Semantics:
 * - `configured === undefined`  → echo the request value verbatim
 *   (legacy permissive default for backwards compatibility). If the
 *   request also omitted the header, fall back to {@link DEFAULT_HEADERS}.
 * - `configured.length === 0`   → deny everything; returns `''`. The
 *   caller is expected to treat the empty string as "do not emit the
 *   header" (see {@link buildPreflightResponse}). This lets operators
 *   express a hard lockdown without inventing a separate flag.
 * - `configured` non-empty      → keep only requested tokens whose
 *   case-insensitive name appears in the allowlist, preserving input
 *   order, de-duplicating case-insensitive repeats. If the request
 *   omitted the header, the full allowlist is advertised so a browser
 *   that probes without `Access-Control-Request-Headers` still knows
 *   what is permitted.
 *
 * Token comparison is case-insensitive. The casing of the **request**
 * is preserved (so a request asking for `Content-Type` gets
 * `Content-Type` back), since browsers compare returned tokens
 * case-insensitively anyway and round-tripping the request casing
 * avoids needless diffs in test snapshots.
 */
const intersectAllowHeaders = (
  requested: string | undefined,
  configured: readonly string[] | undefined,
): string => {
  if (configured === undefined) {
    return requested ?? DEFAULT_HEADERS.join(', ')
  }
  if (configured.length === 0) {
    // Hard lockdown: empty allowlist means deny all requested headers.
    return ''
  }
  if (requested === undefined || requested === '') {
    // No request header → advertise the full allowlist, deduped by
    // case-insensitive name while preserving the configured casing.
    const seen = new Set<string>()
    const out: string[] = []
    for (const h of configured) {
      const key = h.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(h)
    }
    return out.join(', ')
  }
  const allow = new Set<string>()
  for (const h of configured) allow.add(h.toLowerCase())
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of requested.split(',')) {
    const tok = raw.trim()
    if (tok === '') continue
    const key = tok.toLowerCase()
    if (!allow.has(key)) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tok)
  }
  return out.join(', ')
}

/**
 * Build the preflight (`OPTIONS`) response for a given CORS config.
 * The body is empty (204); headers cover origin, methods, headers,
 * max-age, and `Vary: Origin`.
 *
 * `Access-Control-Allow-Headers` honours `cfg.allowHeaders` as a
 * strict allowlist when it is set — anything off the list is dropped
 * even if the browser requested it. When `cfg.allowHeaders` is unset
 * the request value is echoed verbatim (legacy permissive default).
 *
 * The preflight response body itself does not vary on
 * `Access-Control-Request-Method` / `…-Request-Headers` (we always
 * derive the allow-headers value from the request), so those tokens
 * are intentionally omitted to avoid fragmenting downstream caches.
 */
export const buildPreflightResponse = (
  cfg: CorsConfig,
  req: MockRequest,
): MockResponse => {
  const reqOrigin = req.headers['origin'] ?? ''
  const allowMethods = (cfg.allowMethods ?? DEFAULT_METHODS).join(', ')
  const requested = req.headers['access-control-request-headers']
  const allowHeaders = intersectAllowHeaders(requested, cfg.allowHeaders)
  const allowed = resolveOrigin(cfg, reqOrigin)
  const headers: Record<string, string> = {
    'access-control-allow-methods': allowMethods,
    'access-control-max-age': String(cfg.maxAge ?? 86_400),
    vary: 'Origin',
  }
  // Empty string == hard lockdown from intersectAllowHeaders.
  // Emitting `access-control-allow-headers: ` would be a syntactically
  // valid but functionally hostile header; omit it instead so the
  // browser falls back to denying the preflight cleanly.
  if (allowHeaders !== '') {
    headers['access-control-allow-headers'] = allowHeaders
  }
  if (allowed !== '') headers['access-control-allow-origin'] = allowed
  if (cfg.credentials) headers['access-control-allow-credentials'] = 'true'
  return { empty: true, status: 204, headers }
}
