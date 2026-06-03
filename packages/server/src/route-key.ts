import type { Method, RouteKey } from './types.js'

const SUPPORTED_METHODS: ReadonlySet<Method> = new Set<Method>([
  'get',
  'post',
  'put',
  'delete',
  'patch',
])

export interface ParsedRouteKey {
  readonly method: Method
  readonly path: string
}

/**
 * A single path segment of a parsed pattern.
 *
 * `static` segments must match the request segment literally;
 * `param` segments capture into `Record<string,string>`.
 */
export type PatternSegment =
  | { readonly kind: 'static'; readonly value: string }
  | { readonly kind: 'param'; readonly name: string }

export interface RoutePattern {
  /** Original path string as declared (post-trim). */
  readonly path: string
  /** Ordered segments between `/`. Empty array means the root `/`. */
  readonly segments: readonly PatternSegment[]
  /** `true` when no segment is a `:param`. Enables O(1) Map lookup. */
  readonly isStatic: boolean
}

/**
 * Parse a `'METHOD /path'` key.
 *
 * Errors out with a precise message on:
 * - missing space between method and path
 * - unsupported method (lower-case method names included — the
 *   `RouteKey` template literal requires `Uppercase<…>`,
 *   so silently accepting `'get /x'` would mean the type and runtime
 *   disagree and JSON-config typos slip through unnoticed)
 * - path that does not start with `/`
 *
 * Whitespace around the path is trimmed; trailing slashes are kept
 * as-is so the consumer's intent (e.g. matching `/foo/`) is honoured.
 */
export const parseRouteKey = (key: RouteKey): ParsedRouteKey => {
  const idx = key.indexOf(' ')
  if (idx < 0) {
    throw new Error(`@databehave/server: invalid route key (missing space): ${JSON.stringify(key)}`)
  }
  const rawMethod = key.slice(0, idx)
  if (rawMethod !== rawMethod.toUpperCase()) {
    throw new Error(
      `@databehave/server: method must be upper-case in key ${JSON.stringify(key)} ` +
        `(got ${JSON.stringify(rawMethod)}; e.g. 'GET /users')`,
    )
  }
  const method = rawMethod.toLowerCase() as Method
  const path = key.slice(idx + 1).trim()
  if (!SUPPORTED_METHODS.has(method)) {
    throw new Error(
      `@databehave/server: unsupported method in key ${JSON.stringify(key)} (got ${JSON.stringify(
        rawMethod,
      )})`,
    )
  }
  if (!path.startsWith('/')) {
    throw new Error(
      `@databehave/server: path must start with '/' in key ${JSON.stringify(key)} (got ${JSON.stringify(
        path,
      )})`,
    )
  }
  return { method, path }
}

/**
 * Split a path into segments and classify each as `static` or `param`.
 *
 * A segment of just `:` (empty param name) is rejected. Duplicate
 * param names within one pattern are rejected — they would silently
 * overwrite each other in the captured map.
 */
export const parseRoutePattern = (path: string): RoutePattern => {
  // Drop leading '/'; split on '/'. A trailing '/' produces an empty
  // final segment that we keep — it lets a pattern `/foo/` only match
  // requests ending in `/`.
  const raw = path.slice(1).split('/')
  const seen = new Set<string>()
  const segments: PatternSegment[] = raw.map((s) => {
    if (s.startsWith(':')) {
      const name = s.slice(1)
      if (name.length === 0) {
        throw new Error(`@databehave/server: empty param name in path ${JSON.stringify(path)}`)
      }
      if (seen.has(name)) {
        throw new Error(
          `@databehave/server: duplicate param ':${name}' in path ${JSON.stringify(path)}`,
        )
      }
      seen.add(name)
      return { kind: 'param', name }
    }
    return { kind: 'static', value: s }
  })
  const isStatic = segments.every((s) => s.kind === 'static')
  return { path, segments, isStatic }
}

/**
 * Try to match `requestPath` against `pattern`. Returns the captured
 * params on success, `null` on no match.
 *
 * Segment counts must be equal. `static` segments use strict string
 * equality (case-sensitive, no URL-decoding beyond what the URL
 * already gave us). `param` values are URL-decoded so a handler sees
 * `/users/%C3%A9` as `{ id: 'é' }`.
 */
export const matchPattern = (
  pattern: RoutePattern,
  requestPath: string,
): Record<string, string> | null => {
  const reqSegments = requestPath.slice(1).split('/')
  if (reqSegments.length !== pattern.segments.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pattern.segments.length; i++) {
    const seg = pattern.segments[i]!
    const part = reqSegments[i]!
    if (seg.kind === 'static') {
      if (seg.value !== part) return null
    } else {
      try {
        params[seg.name] = decodeURIComponent(part)
      } catch {
        // Malformed %-escape — treat as no match rather than throwing.
        return null
      }
    }
  }
  return params
}
