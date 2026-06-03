/**
 * Inbound request-validation middleware (opt-in, zero-runtime-dep).
 *
 * Builds per-route validator descriptors from the OpenAPI document at
 * server-start (build-time errors propagate up through the server
 * boot). Per-request, validates body / path / query / header
 * parameters and security against the schema and emits an RFC 7807
 * `application/problem+json` envelope on violation.
 *
 * Status mapping:
 *   400 — malformed JSON body
 *   401 — required security scheme not satisfied
 *   415 — request body content-type not declared by the spec
 *   422 — semantic validation failure (one or more `violations`)
 *
 * Body coercion: body validation is strict (no coercion) — mirroring
 * how a real client/server pair speaks JSON. Path / query / header
 * parameters arrive as strings on the wire, so they are coerced
 * (integer / number / boolean) before validation.
 */
import type { OasDoc, OasNode } from '../openapi/walker.js'
import { matchPattern, parseRoutePattern, type RoutePattern } from '../route-key.js'
import { compileValidator, type Validator, type Violation } from '../validation/validate.js'

const PROBLEM_TYPE_BASE =
  'https://github.com/ochairo/databehave/blob/main/docs/errors'

const PROBLEM_TYPE_SLUG: Record<number, string> = {
  400: 'malformed-body',
  401: 'unauthorized',
  413: 'payload-too-large',
  415: 'unsupported-media-type',
  422: 'request-validation',
}

const problemType = (status: number): string =>
  `${PROBLEM_TYPE_BASE}/${PROBLEM_TYPE_SLUG[status] ?? 'request-validation'}.md`

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'trace'])

// Default cap on request-body size (bytes). Matches the express
// `body-parser` default; raise via `validation.maxBodyBytes` only if
// the spec genuinely demands large bodies.
const DEFAULT_MAX_BODY_BYTES = 102400

const STATUS_TITLES: Record<number, string> = {
  400: 'Malformed request',
  401: 'Unauthorized',
  413: 'Payload too large',
  415: 'Unsupported media type',
  422: 'Request validation failed',
}

interface ParamSpec {
  readonly name: string
  readonly in: 'query' | 'path' | 'header'
  readonly required: boolean
  readonly type: string | null
  readonly validator: Validator
}

interface RouteValidator {
  readonly method: string
  readonly pattern: RoutePattern
  readonly hasJsonBody: boolean
  readonly bodyOnlyJson: boolean
  readonly bodyRequired: boolean
  readonly bodyValidator: Validator | null
  readonly params: readonly ParamSpec[]
  readonly security: readonly Readonly<Record<string, readonly string[]>>[]
}

interface SecurityScheme {
  readonly type: 'http' | 'apiKey' | 'oauth2' | 'openIdConnect'
  readonly scheme?: string
  readonly in?: 'header' | 'query' | 'cookie'
  readonly name?: string
}

export interface RequestValidationContext {
  readonly routes: readonly RouteValidator[]
  readonly schemes: ReadonlyMap<string, SecurityScheme>
  /** Hard cap on JSON body size in bytes (UTF-8). Default 100 KB. */
  readonly maxBodyBytes: number
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const oasPathToInternal = (p: string): string =>
  p
    .split('/')
    .map((s) => (s.startsWith('{') && s.endsWith('}') ? `:${s.slice(1, -1)}` : s))
    .join('/')

interface ResolvedParameter {
  readonly in: 'query' | 'path' | 'header' | 'cookie'
  readonly name: string
  readonly required?: boolean
  readonly schema?: OasNode
}

const resolveParam = (raw: unknown, doc: OasDoc): ResolvedParameter | null => {
  if (!isObj(raw)) return null
  let node: Record<string, unknown> = raw
  if (typeof node.$ref === 'string') {
    const m = /^#\/components\/parameters\/(.+)$/.exec(node.$ref)
    if (!m) return null
    const docAny = doc as { components?: { parameters?: Record<string, unknown> } }
    const target = docAny.components?.parameters?.[decodeURIComponent(m[1]!)]
    if (!isObj(target)) return null
    node = target
  }
  if (typeof node.in !== 'string' || typeof node.name !== 'string') return null
  return node as unknown as ResolvedParameter
}

export const createRequestValidationContext = (
  oas: OasDoc,
  options: { readonly maxBodyBytes?: number } = {},
): RequestValidationContext => {
  const doc = oas as OasDoc & {
    paths?: Record<string, Record<string, unknown>>
    components?: { securitySchemes?: Record<string, SecurityScheme> }
    security?: ReadonlyArray<Record<string, readonly string[]>>
  }
  const schemes = new Map<string, SecurityScheme>()
  for (const [name, scheme] of Object.entries(doc.components?.securitySchemes ?? {})) {
    if (isObj(scheme) && typeof scheme.type === 'string') {
      schemes.set(name, scheme as SecurityScheme)
    }
  }
  const globalSecurity = doc.security ?? []
  const routes: RouteValidator[] = []
  for (const [oasPath, methods] of Object.entries(doc.paths ?? {})) {
    if (!isObj(methods)) continue
    let pattern: RoutePattern
    try {
      pattern = parseRoutePattern(oasPathToInternal(oasPath))
    } catch {
      continue
    }
    const pathLevelParams = Array.isArray((methods as { parameters?: unknown }).parameters)
      ? ((methods as { parameters: unknown[] }).parameters as unknown[])
      : []
    for (const [methodName, op] of Object.entries(methods)) {
      if (methodName === 'parameters' || !HTTP_METHODS.has(methodName)) continue
      if (!isObj(op)) continue
      const opNode = op as {
        parameters?: unknown[]
        requestBody?: {
          required?: boolean
          content?: Record<string, { schema?: OasNode }>
        }
        security?: ReadonlyArray<Record<string, readonly string[]>>
      }
      const params: ParamSpec[] = []
      const rawParams = [...pathLevelParams, ...(opNode.parameters ?? [])]
      for (const raw of rawParams) {
        const p = resolveParam(raw, doc)
        if (!p || p.in === 'cookie') continue
        const schema = (p.schema ?? {}) as OasNode
        const validator = compileValidator(
          schema,
          doc,
          `#/paths/${oasPath}/${methodName}/parameters/${p.name}`,
        )
        params.push({
          name: p.name,
          in: p.in,
          required: p.required === true || p.in === 'path',
          type: typeof schema.type === 'string' ? schema.type : null,
          validator,
        })
      }
      const requestBody = opNode.requestBody
      const content = requestBody?.content
      const declaredTypes = content ? Object.keys(content) : []
      const hasJsonBody = declaredTypes.length > 0
      const bodyOnlyJson =
        hasJsonBody &&
        declaredTypes.every((c) => /^application\/json(\b|;)/i.test(c))
      const jsonSchema = content?.['application/json']?.schema
      const bodyValidator = jsonSchema
        ? compileValidator(jsonSchema, doc, `#/paths/${oasPath}/${methodName}/requestBody`)
        : null
      routes.push({
        method: methodName.toUpperCase(),
        pattern,
        hasJsonBody,
        bodyOnlyJson,
        bodyRequired: requestBody?.required === true,
        bodyValidator,
        params,
        security: opNode.security ?? globalSecurity,
      })
    }
  }
  return {
    routes,
    schemes,
    maxBodyBytes:
      typeof options.maxBodyBytes === 'number' && options.maxBodyBytes > 0
        ? options.maxBodyBytes
        : DEFAULT_MAX_BODY_BYTES,
  }
}

const coerce = (raw: string, type: string | null): unknown => {
  if (type === 'integer') {
    if (!/^-?\d+$/.test(raw)) return raw
    const n = Number(raw)
    return Number.isFinite(n) ? n : raw
  }
  if (type === 'number') {
    if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return raw
    const n = Number(raw)
    return Number.isFinite(n) ? n : raw
  }
  if (type === 'boolean') {
    if (raw === 'true') return true
    if (raw === 'false') return false
    return raw
  }
  return raw
}

const isSecuritySatisfied = (
  req: Readonly<Record<string, readonly string[]>>,
  ctx: RequestValidationContext,
  headers: Map<string, string>,
  url: URL,
): boolean => {
  const names = Object.keys(req)
  if (names.length === 0) return true
  return names.every((name) => {
    const scheme = ctx.schemes.get(name)
    if (!scheme) return false
    if (scheme.type === 'http') {
      const auth = headers.get('authorization') ?? ''
      const want = (scheme.scheme ?? 'bearer').toLowerCase()
      return new RegExp(`^${want}\\s+`, 'i').test(auth)
    }
    if (scheme.type === 'apiKey') {
      if (scheme.in === 'header' && scheme.name) {
        return headers.has(scheme.name.toLowerCase())
      }
      if (scheme.in === 'query' && scheme.name) {
        return url.searchParams.has(scheme.name)
      }
      return false
    }
    // oauth2 / openIdConnect: presence-only check; full token validation
    // (introspection, signature verification) is out of scope for a
    // zero-dep walker. Consumers needing it should layer it via
    // `hooks.onRequest`.
    return headers.has('authorization')
  })
}

const buildAuthChallenge = (
  reqs: readonly Readonly<Record<string, readonly string[]>>[],
  ctx: RequestValidationContext,
): Record<string, string> => {
  for (const r of reqs) {
    for (const name of Object.keys(r)) {
      const scheme = ctx.schemes.get(name)
      if (scheme?.type === 'http') {
        const s = (scheme.scheme ?? 'bearer').replace(/^./, (c) => c.toUpperCase())
        return { 'www-authenticate': `${s} realm="api"` }
      }
    }
  }
  return { 'www-authenticate': 'Bearer realm="api"' }
}

const problem = (
  status: number,
  detail: string,
  violations: readonly Violation[] = [],
  extraHeaders: Record<string, string> = {},
): Response => {
  const body: {
    type: string
    title: string
    status: number
    detail: string
    violations?: readonly Violation[]
  } = {
    type: problemType(status),
    title: STATUS_TITLES[status] ?? 'Request validation failed',
    status,
    detail,
  }
  if (violations.length > 0) body.violations = violations
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/problem+json',
      ...extraHeaders,
    },
  })
}

export const validateRequest = async (
  req: Request,
  ctx: RequestValidationContext,
): Promise<Response | null> => {
  const url = new URL(req.url)
  const method = req.method.toUpperCase()
  let matched: { route: RouteValidator; params: Readonly<Record<string, string>> } | null = null
  for (const r of ctx.routes) {
    if (r.method !== method) continue
    const params = matchPattern(r.pattern, url.pathname)
    if (params) {
      matched = { route: r, params }
      break
    }
  }
  // Unmatched paths fall through — they are either hand-written routes
  // outside the OAS document or genuine 404s. Either way the validator
  // has no contract to enforce.
  if (!matched) return null

  const { route, params } = matched
  const headers = new Map<string, string>()
  req.headers.forEach((v, k) => headers.set(k.toLowerCase(), v))

  // 1) Security gate.
  if (route.security.length > 0) {
    const ok = route.security.some((sr) => isSecuritySatisfied(sr, ctx, headers, url))
    if (!ok) {
      return problem(
        401,
        'missing or invalid credentials',
        [],
        buildAuthChallenge(route.security, ctx),
      )
    }
  }

  const hasBodyMethod = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
  const contentType = (headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''

  // 2) Content-Type guard for routes that declare a JSON-only requestBody.
  if (hasBodyMethod && route.bodyOnlyJson && contentType && contentType !== 'application/json') {
    return problem(415, `unsupported media type '${contentType}' (expected application/json)`)
  }

  const violations: Violation[] = []

  // 3) Body parse + validate.
  if (hasBodyMethod && route.bodyValidator) {
    let raw = ''
    try {
      raw = await req.clone().text()
      /* c8 ignore start — `Request#clone().text()` only rejects on stream
         I/O errors which the in-process unit harness cannot trigger. */
    } catch {
      raw = ''
    }
    /* c8 ignore stop */
    if (raw.length === 0) {
      if (route.bodyRequired) {
        return problem(422, 'request body is required', [
          { path: '/body', keyword: 'required', message: 'missing required body' },
        ])
      }
    } else {
      // Cap pre-parse body size (UTF-8 byte length, not JS string length).
      // Default matches express body-parser; raise via
      // `validation.maxBodyBytes` only if the spec demands large bodies.
      const byteLen = Buffer.byteLength(raw, 'utf8')
      if (byteLen > ctx.maxBodyBytes) {
        return problem(
          413,
          `request body exceeds maxBodyBytes (${ctx.maxBodyBytes})`,
        )
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return problem(400, 'malformed JSON body')
      }
      violations.push(...route.bodyValidator(parsed, '/body'))
    }
  }

  // 4) Param validation (with type coercion for query/path/header).
  for (const p of route.params) {
    if (p.in === 'query') {
      const raw = url.searchParams.get(p.name)
      if (raw === null) {
        if (p.required) {
          violations.push({
            path: `/query/${p.name}`,
            keyword: 'required',
            message: 'missing required query parameter',
          })
        }
        continue
      }
      violations.push(...p.validator(coerce(raw, p.type), `/query/${p.name}`))
    } else if (p.in === 'path') {
      const raw = params[p.name]
      // Defensive: `matchPattern` always populates every named path
      // segment when the route matches, so a missing path param is
      // unreachable in practice. Kept as a guard against future
      // refactors that loosen the matcher contract.
      /* c8 ignore start */
      if (raw === undefined) {
        violations.push({
          path: `/path/${p.name}`,
          keyword: 'required',
          message: 'missing required path parameter',
        })
        continue
      }
      /* c8 ignore stop */
      violations.push(...p.validator(coerce(raw, p.type), `/path/${p.name}`))
    } else {
      const raw = headers.get(p.name.toLowerCase())
      if (raw === undefined) {
        if (p.required) {
          violations.push({
            path: `/header/${p.name}`,
            keyword: 'required',
            message: 'missing required header',
          })
        }
        continue
      }
      violations.push(...p.validator(coerce(raw, p.type), `/header/${p.name}`))
    }
  }

  if (violations.length > 0) {
    return problem(
      422,
      `request validation failed (${violations.length} violation${violations.length === 1 ? '' : 's'})`,
      violations,
    )
  }
  return null
}
