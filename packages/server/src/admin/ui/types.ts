/**
 * UI-side mirrors of the kit's admin types. Kept here (rather than
 * importing from `../admin-types.ts`) so the browser bundle does
 * NOT pull node:crypto / node:fs transitively. The shapes must stay
 * structurally compatible with the JSON returned by `${path}/*`
 * (the admin REST routes; `path` defaults to `/databehave`).
 */
export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | string

export type ErrorMode =
  | { kind: 'http-status'; status: number }
  | { kind: 'business-failure'; message: string; extra?: Record<string, unknown> }
  | { kind: 'custom-body'; status?: number; body: unknown; contentType?: string }
  | { kind: 'empty-body'; status?: number }
  | { kind: 'malformed-json'; status?: number }
  | { kind: 'delay'; ms: number }
  | { kind: 'hang' }
  | { kind: 'destroy' }

export type Matcher =
  | { kind: 'exact'; method: string; path: string }
  | { kind: 'path'; path: string }
  | { kind: 'global'; methods?: readonly string[] }

/**
 * True when a `global` matcher applies to the given HTTP method.
 * A global with no `methods` filter (or empty list) applies to all.
 */
export const globalAppliesTo = (
  m: Extract<Matcher, { kind: 'global' }>,
  method: string,
): boolean => {
  if (!m.methods || m.methods.length === 0) return true
  const M = method.toUpperCase()
  return m.methods.some((x) => x.toUpperCase() === M)
}

export interface StickyOverride {
  id: string
  matcher: Matcher
  mode: ErrorMode
  createdAt: string
  description?: string
}

export interface RouteSummary {
  method: Method
  path: string
  summary?: string
  /** 'handler' when the route is registered on the dispatcher but absent from the OAS doc. */
  source?: 'openapi' | 'handler'
}

/** OpenAPI 3 op shape — only the fields the UI reads. */
export interface OpenApiOp {
  summary?: string
  description?: string
  tags?: string[]
  parameters?: OpenApiParam[]
  requestBody?: {
    description?: string
    content?: Record<string, { schema?: OpenApiSchema; example?: unknown }>
  }
  responses?: Record<
    string,
    {
      description?: string
      content?: Record<string, { schema?: OpenApiSchema; example?: unknown }>
    }
  >
}

export interface OpenApiParam {
  name: string
  in: 'query' | 'header' | 'path' | 'cookie'
  required?: boolean
  description?: string
  schema?: OpenApiSchema
}

export interface OpenApiSchema {
  type?: string
  format?: string
  enum?: unknown[]
  example?: unknown
  default?: unknown
  description?: string
  properties?: Record<string, OpenApiSchema>
  required?: string[]
  items?: OpenApiSchema
  oneOf?: OpenApiSchema[]
  anyOf?: OpenApiSchema[]
  allOf?: OpenApiSchema[]
  $ref?: string
  nullable?: boolean
}

export interface OpenApiDoc {
  info?: { title?: string; version?: string }
  paths?: Record<string, Record<string, OpenApiOp>>
  components?: { schemas?: Record<string, OpenApiSchema> }
}

export interface Operation {
  method: Method
  path: string
  op: OpenApiOp
  groupKey: string
  /** First tag, or first path segment fallback. */
  groupLabel: string
  /** 'handler' when no OAS spec is available for this route. Defaults to 'openapi'. */
  source?: 'openapi' | 'handler'
}

export type ScopeKind = 'exact' | 'path' | 'global'
export type ModeKind = ErrorMode['kind']

export interface ScenarioSummary {
  name: string
  count: number
  created: string
}

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
}
