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
 *   400 — malformed JSON body or interrupted/failed body read
 *   401 — required security scheme not satisfied
 *   413 — request body exceeds the byte limit
 *   415 — request body content-type not declared by the spec
 *   422 — semantic validation failure (one or more `violations`)
 *
 * Body coercion: body validation is strict (no coercion) — mirroring
 * how a real client/server pair speaks JSON. Path / query / header
 * parameters arrive as strings on the wire, so they are coerced
 * (integer / number / boolean) before validation.
 */
import type { OpenApiCatalog } from '../catalog.js'
import type { OasDoc, OasNode } from '../openapi/walker.js'
import { matchPattern, parseRoutePattern, type RoutePattern } from '@databehave/server'
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

/** Prepared OpenAPI ParamSpec metadata. */
interface ParamSpec {
  readonly name: string
  readonly in: 'query' | 'path' | 'header'
  readonly required: boolean
  readonly type: string | null
  readonly validator: Validator
}

/** Prepared OpenAPI RouteValidator metadata. */
interface RouteValidator {
  readonly key: string
  readonly pattern: RoutePattern
  readonly hasBody: boolean
  readonly hasJsonBody: boolean
  readonly bodyOnlyJson: boolean
  readonly bodyRequired: boolean
  readonly bodyValidator: Validator | null
  readonly params: readonly ParamSpec[]
  readonly security: readonly Readonly<Record<string, readonly string[]>>[]
}

/** Prepared OpenAPI SecurityScheme metadata. */
interface SecurityScheme {
  readonly type: 'http' | 'apiKey' | 'oauth2' | 'openIdConnect'
  readonly scheme?: string
  readonly in?: 'header' | 'query' | 'cookie'
  readonly name?: string
}

/** Prepared conformance checks attached to the authoritative operation catalog. */
export interface RequestValidationContext {
  readonly catalog: OpenApiCatalog
  readonly routes: readonly RouteValidator[]
  readonly schemes: ReadonlyMap<string, SecurityScheme>
  /** Hard cap on declared body size in bytes (UTF-8). Default 100 KB. */
  readonly maxBodyBytes: number
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Prepared OpenAPI ResolvedParameter metadata. */
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
  const location = node.in
  if ((location !== 'query' && location !== 'path' && location !== 'header' && location !== 'cookie') || typeof node.name !== 'string') return null
  return {
    in: location, name: node.name,
    ...(typeof node.required === 'boolean' ? { required: node.required } : {}),
    ...(isObj(node.schema) ? { schema: node.schema as OasNode } : {}),
  }
}

export const createRequestValidationContext = (
  catalog: OpenApiCatalog,
  options: { readonly maxBodyBytes?: number } = {},
): RequestValidationContext => {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 0) {
    throw new Error('maxBodyBytes must be a nonnegative safe integer')
  }
  const doc = catalog.document as OasDoc & {
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
  for (const operation of catalog.operations) {
    const oasPath = operation.sourcePath
    const methodName = operation.method
    const pattern = parseRoutePattern(operation.path)
    const pathLevelParams = operation.pathParameters
    const op = operation.definition
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
    const hasJsonBody = declaredTypes.some((c) => /^application\/json(\b|;)/i.test(c))
    const bodyOnlyJson =
      hasJsonBody &&
      declaredTypes.every((c) => /^application\/json(\b|;)/i.test(c))
    const jsonSchema = content?.['application/json']?.schema
    const bodyValidator = jsonSchema
      ? compileValidator(jsonSchema, doc, `#/paths/${oasPath}/${methodName}/requestBody`)
      : null
    routes.push({
      key: operation.key,
      pattern,
      hasBody: requestBody !== undefined,
      hasJsonBody,
      bodyOnlyJson,
      bodyRequired: requestBody?.required === true,
      bodyValidator,
      params,
      security: opNode.security ?? globalSecurity,
    })
  }
  return {
    catalog,
    routes,
    schemes,
    maxBodyBytes,
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
    // a separate HTTP preflight or validation plugin.
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

/** A bounded read distinguishes an absent body from failed or interrupted I/O. */
type BodyRead = { readonly raw: string; readonly bytes: number } | { readonly response: Response }

const readBody = async (req: Request, maxBodyBytes: number): Promise<BodyRead> => {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  // Tee cancellation only reaches the source after both branches cancel. Neither
  // promise can be awaited here: a user source may never settle its cancel hook.
  const cancel = () => {
    void reader?.cancel().catch(() => {})
    void req.body?.cancel().catch(() => {})
  }
  let onAbort: () => void = () => {}
  try {
    if (req.signal.aborted) throw new Error('request aborted')
    reader = req.clone().body?.getReader()
    if (!reader) return { raw: '', bytes: 0 }
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('request aborted'))
      req.signal.addEventListener('abort', onAbort, { once: true })
    })
    const decoder = new TextDecoder()
    let bytes = 0
    let raw = ''
    while (true) {
      const chunk = await Promise.race([reader.read(), aborted])
      if (req.signal.aborted) throw new Error('request aborted')
      if (chunk.done) return { raw: raw + decoder.decode(), bytes }
      bytes += chunk.value.byteLength
      if (bytes > maxBodyBytes) {
        cancel()
        return { response: problem(413, `request body exceeds maxBodyBytes (${maxBodyBytes})`) }
      }
      raw += decoder.decode(chunk.value, { stream: true })
    }
  } catch {
    cancel()
    return { response: problem(400, 'request body could not be read') }
  } finally {
    req.signal.removeEventListener('abort', onAbort)
    reader?.releaseLock()
  }
}

export const validateRequest = async (
  req: Request,
  ctx: RequestValidationContext,
  effectiveMethod = req.method,
): Promise<Response | null> => {
  const url = new URL(req.url)
  const method = effectiveMethod.toUpperCase()
  const operation = ctx.catalog.find(method, url.pathname)
  let matched: { route: RouteValidator; params: Readonly<Record<string, string>> } | null = null
  for (const r of ctx.routes) {
    if (r.key !== operation?.key) continue
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

  const hasBodyMethod = method !== 'GET' && method !== 'HEAD'
  const contentType = (headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''

  // 2) Content-Type guard for routes that declare a JSON-only requestBody.
  if (hasBodyMethod && route.bodyOnlyJson && contentType && contentType !== 'application/json') {
    return problem(415, `unsupported media type '${contentType}' (expected application/json)`)
  }

  const violations: Violation[] = []

  // 3) Body parse + validate.
  if (hasBodyMethod && route.hasBody) {
    const body = await readBody(req, ctx.maxBodyBytes)
    if ('response' in body) return body.response
    const { raw } = body
    if (body.bytes === 0) {
      if (route.bodyRequired) {
        return problem(422, 'request body is required', [
          { path: '/body', keyword: 'required', message: 'missing required body' },
        ])
      }
    } else if (route.hasJsonBody && (!contentType || contentType === 'application/json')) {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return problem(400, 'malformed JSON body')
      }
      if (route.bodyValidator) violations.push(...route.bodyValidator(parsed, '/body'))
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
