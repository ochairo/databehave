import type { AdminModeCors } from './admin-types.js'

const wildcard = (bind: 'loopback-only' | 'any', cors: AdminModeCors): boolean =>
  cors === 'any' || (cors === 'auto' && bind === 'loopback-only')

/** Origin-less local clients are allowed; a present Origin must be a valid HTTP origin. */
export const isAdminOriginAllowed = (
  bind: 'loopback-only' | 'any', cors: AdminModeCors, origin: string | undefined, requestUrl: string,
): boolean => {
  if (origin === undefined) return true
  try {
    const parsed = new URL(origin)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) return false
  } catch { return false }
  if (origin === new URL(requestUrl).origin || wildcard(bind, cors)) return true
  if (typeof cors === 'object') return typeof cors.origin === 'string' ? cors.origin === origin : cors.origin.includes(origin)
  return false
}

/** Admin owns response sharing; allowlists reflect exactly one permitted request origin. */
export const resolveAdminCors = (
  bind: 'loopback-only' | 'any', cors: AdminModeCors, requestOrigin = '',
): Record<string, string> => {
  let origin: string | undefined
  if (wildcard(bind, cors)) origin = '*'
  else if (typeof cors === 'object') {
    const allowed = typeof cors.origin === 'string' ? [cors.origin] : cors.origin
    if (allowed.includes(requestOrigin)) origin = requestOrigin
  }
  if (!origin) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin',
  }
}
