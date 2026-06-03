/**
 * Resolve the static CORS header bag added to admin-route responses.
 *
 * The policy is intentionally tiny: admin endpoints are dev-only and
 * never see browser credentials, so a full `Access-Control-*`
 * negotiation would be overkill. We just need to decide whether the
 * UI / a bookmarklet on a different origin can XHR into them.
 *
 * Defaults:
 *   - `'auto'` + loopback-only bind  → `'*'` (UI on any localhost port works)
 *   - `'auto'` + bind: 'any'         → `'same-origin'` (LAN-exposed: lock down)
 *   - `'any'`                        → `'*'`
 *   - `'same-origin'`                → no CORS headers added
 *   - `{ origin: 'x' | ['x', ...] }` → first allowed origin (string join with ', ')
 *
 * Returned object is a `Record<string, string>` ready to splat into
 * `MockResponse.headers`. Empty object when no CORS headers
 * should be added (same-origin).
 */
import type { AdminModeCors, AdminModeConfig } from './admin-types.js'

const PERMISSIVE_METHODS = 'GET,POST,DELETE,OPTIONS'
const PERMISSIVE_HEADERS = 'content-type'

const wildcardHeaders = (): Record<string, string> => ({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': PERMISSIVE_METHODS,
  'access-control-allow-headers': PERMISSIVE_HEADERS,
})

const explicitOriginHeaders = (
  origin: string | readonly string[],
): Record<string, string> => {
  const value = Array.isArray(origin) ? origin.join(', ') : (origin as string)
  return {
    'access-control-allow-origin': value,
    'access-control-allow-methods': PERMISSIVE_METHODS,
    'access-control-allow-headers': PERMISSIVE_HEADERS,
    vary: 'Origin',
  }
}

export const resolveAdminCors = (
  bind: NonNullable<AdminModeConfig['bind']>,
  cors: AdminModeCors,
): Record<string, string> => {
  if (cors === 'same-origin') return {}
  if (cors === 'any') return wildcardHeaders()
  if (cors === 'auto') {
    return bind === 'loopback-only' ? wildcardHeaders() : {}
  }
  // explicit { origin } form
  return explicitOriginHeaders(cors.origin)
}
