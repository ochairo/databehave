/**
 * Opt-in per-request access logger.
 *
 * One line per request, written to **stdout**. Default off — when the
 * top-level `log` config is absent or `false`, no logger is built and
 * the request hot path is untouched.
 *
 * Format `pretty` (default) — ANSI-coloured one-liner like:
 *
 *     GET /api/v1/health → 200 4 ms · 56
 *
 * Format `json` — newline-terminated JSON object suitable for piping
 * into structured log collectors:
 *
 *     {"t":"2026-05-28T…","method":"GET","path":"/api/v1/health","status":200,"ms":4,"bytes":56}
 *
 * Sticky / header overrides synthesised by the admin inject hook are
 * marked with ` [override:<mode.kind>]` (pretty) or `"override":"<kind>"` (json).
 *
 * Admin-panel traffic is suppressed by default — set `includeAdmin: true`
 * to log it too. The hot-path check is a single `startsWith` against the
 * resolved admin base path.
 */
import type { LogConfig } from './types.js'

export interface ResolvedLogConfig {
  readonly access: boolean
  readonly includeAdmin: boolean
  readonly colors: boolean
  readonly format: 'pretty' | 'json'
}

export interface LogEvent {
  readonly method: string
  readonly path: string
  readonly status: number
  readonly ms: number
  readonly bytes: string
  readonly override: string | undefined
  readonly error: string | undefined
}

export interface AccessLogger {
  readonly emit: (ev: LogEvent) => void
  readonly isAdminPath: (path: string) => boolean
}

const RESET = '\x1b[0m'
// Method palette mirrors the admin-UI badge colours.
const METHOD_COLOR: Record<string, string> = {
  GET: '\x1b[32m', // green
  POST: '\x1b[34m', // blue
  PUT: '\x1b[33m', // orange-ish (yellow ANSI)
  DELETE: '\x1b[31m', // red
  PATCH: '\x1b[36m', // teal (cyan ANSI)
}

const statusColor = (s: number): string => {
  if (s >= 500) return '\x1b[31m'
  if (s >= 400) return '\x1b[33m'
  if (s >= 300) return '\x1b[36m'
  if (s >= 200) return '\x1b[32m'
  return '\x1b[90m'
}

const paint = (use: boolean, color: string, text: string): string =>
  use ? `${color}${text}${RESET}` : text

const resolveColors = (
  pref: 'auto' | 'always' | 'never',
): boolean => {
  if (pref === 'always') return true
  if (pref === 'never') return false
  // 'auto'
  return Boolean(process.stdout && (process.stdout as { isTTY?: boolean }).isTTY)
}

/**
 * Resolve a user-supplied `log` config into a normalised shape, or
 * `null` when logging is disabled. Pure — safe to call at construction.
 */
export const resolveLogConfig = (
  cfg: LogConfig | undefined,
): ResolvedLogConfig | null => {
  if (cfg === undefined || cfg === false) return null
  if (cfg === true) {
    return {
      access: true,
      includeAdmin: false,
      colors: resolveColors('auto'),
      format: 'pretty',
    }
  }
  const access = cfg.access !== false
  if (!access) return null
  return {
    access,
    includeAdmin: cfg.includeAdmin === true,
    colors: resolveColors(cfg.colors ?? 'auto'),
    format: cfg.format ?? 'pretty',
  }
}

/**
 * Build an access logger bound to the resolved config + admin path.
 * `adminPath` is the resolved `admin.path` (e.g. `/mock`), or
 * `undefined` when admin mode is off. Returns `null` when logging is
 * disabled — callers should short-circuit on `null` to avoid any
 * per-request allocation.
 */
export const createAccessLogger = (
  cfg: LogConfig | undefined,
  adminPath: string | undefined,
): AccessLogger | null => {
  const resolved = resolveLogConfig(cfg)
  if (!resolved) return null

  const adminPrefix = adminPath
  const isAdminPath = (path: string): boolean => {
    if (adminPrefix === undefined) return false
    return path === adminPrefix || path.startsWith(`${adminPrefix}/`)
  }

  const write = (line: string): void => {
    process.stdout.write(line)
  }

  const emit = (ev: LogEvent): void => {
    if (!resolved.includeAdmin && isAdminPath(ev.path)) return
    if (resolved.format === 'json') {
      const obj: Record<string, unknown> = {
        t: new Date().toISOString(),
        method: ev.method,
        path: ev.path,
        status: ev.status,
        ms: ev.ms,
        bytes: ev.bytes,
      }
      if (ev.override !== undefined) obj.override = ev.override
      if (ev.error !== undefined) obj.error = ev.error
      write(`${JSON.stringify(obj)}\n`)
      return
    }
    const c = resolved.colors
    const methodPainted = paint(c, METHOD_COLOR[ev.method] ?? '\x1b[90m', ev.method)
    const statusPainted = paint(c, statusColor(ev.status), String(ev.status))
    const overrideSuffix =
      ev.override !== undefined ? ` [override:${ev.override}]` : ''
    const errorSuffix = ev.error !== undefined ? ` error=${ev.error}` : ''
    write(
      `${methodPainted} ${ev.path} → ${statusPainted} ${ev.ms} ms · ${ev.bytes}${overrideSuffix}${errorSuffix}\n`,
    )
  }

  return { emit, isAdminPath }
}
