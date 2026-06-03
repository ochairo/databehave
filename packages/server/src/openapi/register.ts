/**
 * Build a route table of `Handler`s from an OpenAPI document.
 *
 * The walker visits every `paths.*.<method>` entry. For each that
 * has a non-empty 200 response schema, a deterministic mock body is
 * generated once at boot (so OAS gaps surface at boot, not on the
 * first request) and the handler re-serves it per request.
 *
 * Determinism: the OAS-only generator emits structural placeholder
 * values, so same schema → same body. Per-request seeding (path /
 * query params) is reserved for a future seeded mode (brief #11)
 * and currently has no effect on the body.
 *
 * Endpoints without a usable schema get a tiny stub: `{}` for GET,
 * `{ success: true, message: null }` for mutating methods.
 *
 * Pure: this module never reads files or talks to the HTTP layer. It produces
 * plain `Handler` callables that @databehave/server registers like any
 * hand-written route.
 */
import type { Handler, Method, RouteKey } from '../types.js'

import { generateFromOasSchema } from './generate.js'
import type { OasDoc, OasNode } from './walker.js'

const SUPPORTED_METHODS: ReadonlySet<Method> = new Set<Method>([
  'get',
  'post',
  'put',
  'delete',
  'patch',
])

/**
 * Convert OAS path syntax (`/users/{id}`) into @databehave/server pattern syntax
 * (`/users/:id`). Other `{x}` placeholders not isolated to a single
 * segment are left as-is — the matcher will then reject them at
 * registration time.
 */
const oasPathToInternal = (oasPath: string): string =>
  oasPath
    .split('/')
    .map((seg) => (seg.startsWith('{') && seg.endsWith('}') ? `:${seg.slice(1, -1)}` : seg))
    .join('/')

const stubBody = (method: Method): object =>
  Object.freeze(method === 'get' ? {} : { success: true, message: null })

const buildHandler = (body: unknown): Handler => {
  // The OAS-only generator is structurally deterministic — same
  // schema → same value — so the body is materialised once at boot
  // and re-served per request.
  return () => ({ json: body })
}

const buildStubHandler = (
  _routePath: string,
  method: Method,
): Handler => {
  const body = stubBody(method)
  return () => ({ json: body })
}

export interface OpenApiRoutesOptions {
  /** Route keys (`'METHOD /path'`) the OAS walker must NOT register. */
  readonly skip?: ReadonlySet<RouteKey>
  /** Optional callback for walker failures. Defaults to silent stub fallback. */
  readonly onWalkError?: (
    method: Method,
    routePath: string,
    err: unknown,
  ) => void
  /**
   * Optional callback fired when the OAS declares a response with an
   * empty / permissive schema (`schema: {}`). Per JSON Schema this
   * matches any value, so we still serve a deterministic stub — but
   * the caller usually wants to surface it so the spec gap is fixed.
   */
  readonly onEmptySchema?: (
    method: Method,
    routePath: string,
    status: number,
  ) => void
}

/**
 * `true` when an OAS schema node is empty / permissive (`{}`) —
 * i.e. carries no shape information (no `$ref`, `type`, `enum`,
 * `const`, `properties`, `items`, `allOf`, `oneOf`, `anyOf`).
 * Per JSON Schema this matches any JSON value.
 */
const isEmptyOasSchema = (node: OasNode): boolean =>
  !node.$ref &&
  !node.type &&
  !node.enum &&
  node.const === undefined &&
  !node.properties &&
  !node.items &&
  !node.allOf &&
  !node.oneOf &&
  !node.anyOf

/**
 * Build a per-route per-status JSON body generator map from the OAS
 * `responses` table. Used by mock-mode to synthesize an error body
 * from the schema declared for that status code.
 *
 * Each generator is deterministic: same `(routeKey, status)` always
 * yields the same body. Routes with `:param` segments are matched
 * by exact path key only — runtime path-param substitution is the
 * caller's responsibility.
 *
 * `onWalkError` mirrors `buildOpenApiRoutes` so spec gaps in error
 * responses surface the same way as gaps in success responses.
 */
export const buildOpenApiResponseGenerators = (
  doc: OasDoc,
  options: { onWalkError?: OpenApiRoutesOptions['onWalkError'] } = {},
): Map<RouteKey, Map<number, () => unknown>> => {
  const out = new Map<RouteKey, Map<number, () => unknown>>()
  const paths = (doc as { paths?: Record<string, Record<string, unknown>> }).paths
  if (!paths) return out

  for (const [oasPath, methods] of Object.entries(paths)) {
    if (oasPath === '/') continue
    const kitPath = oasPathToInternal(oasPath)

    for (const [methodName, op] of Object.entries(methods)) {
      const method = methodName.toLowerCase() as Method
      if (!SUPPORTED_METHODS.has(method)) continue

      const key = `${method.toUpperCase()} ${kitPath}` as RouteKey
      const responses = (op as { responses?: Record<string, unknown> }).responses
      if (!responses) continue

      const perStatus = new Map<number, () => unknown>()
      for (const [statusStr, resp] of Object.entries(responses)) {
        const status = Number.parseInt(statusStr, 10)
        if (!Number.isFinite(status)) continue
        const schemaNode = (
          resp as {
            content?: { 'application/json'?: { schema?: OasNode } }
          }
        )?.content?.['application/json']?.schema
        if (!schemaNode || typeof schemaNode !== 'object') continue
        if (isEmptyOasSchema(schemaNode)) {
          // Permissive — let mock-mode fall back to its envelope.
          continue
        }
        try {
          // Pre-generate at boot — the OAS-only generator is
          // structurally deterministic so the body is constant per
          // (route, status).
          const body = generateFromOasSchema(schemaNode, doc)
          perStatus.set(status, () => body)
        } catch (err) {
          // Caller's mock-mode fallback envelope will be used; surface
          // the spec gap so it can be fixed.
          options.onWalkError?.(method, kitPath, err)
        }
      }
      if (perStatus.size > 0) out.set(key, perStatus)
    }
  }
  return out
}

/**
 * Produce a `Map<RouteKey, Handler>` covering every OAS
 * `paths.<p>.<m>` not in `skip`. Failing schemas fall back to the
 * stub body and report via `onWalkError` (default: ignore).
 */
export const buildOpenApiRoutes = (
  doc: OasDoc,
  options: OpenApiRoutesOptions = {},
): Map<RouteKey, Handler> => {
  const out = new Map<RouteKey, Handler>()
  const skip = options.skip ?? new Set<RouteKey>()
  const paths = (doc as { paths?: Record<string, Record<string, unknown>> }).paths
  if (!paths) return out

  for (const [oasPath, methods] of Object.entries(paths)) {
    if (oasPath === '/') continue
    const kitPath = oasPathToInternal(oasPath)

    for (const [methodName, op] of Object.entries(methods)) {
      const method = methodName.toLowerCase() as Method
      if (!SUPPORTED_METHODS.has(method)) continue

      const key = `${method.toUpperCase()} ${kitPath}` as RouteKey
      if (skip.has(key)) continue

      // Prefer 200, then the smallest declared 2xx response \u2014 OAS
      // documents for mutating endpoints often only declare 201 / 202
      // / 204, so falling back to those keeps the synthesised handler
      // honest. 204 explicitly means \"no body\" and is handled below.
      const responses = (op as { responses?: Record<string, unknown> }).responses ?? {}
      const twoXx = Object.keys(responses)
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => Number.isFinite(n) && n >= 200 && n < 300)
        .sort((a, b) => (a === 200 ? -1 : b === 200 ? 1 : a - b))
      const pickedStatus = twoXx[0]
      const pickedKey = pickedStatus !== undefined ? String(pickedStatus) : '200'
      const responseSchema = (
        responses[pickedKey] as
          | { content?: { 'application/json'?: { schema?: OasNode } } }
          | undefined
      )?.content?.['application/json']?.schema

      try {
        if (pickedStatus === 204) {
          out.set(key, buildStubHandler(kitPath, method))
        } else if (responseSchema && typeof responseSchema === 'object') {
          if (isEmptyOasSchema(responseSchema)) {
            options.onEmptySchema?.(method, kitPath, pickedStatus ?? 200)
            out.set(key, buildStubHandler(kitPath, method))
          } else {
            const body = generateFromOasSchema(responseSchema, doc)
            out.set(key, buildHandler(body))
          }
        } else {
          out.set(key, buildStubHandler(kitPath, method))
        }
      } catch (err) {
        options.onWalkError?.(method, kitPath, err)
        out.set(key, buildStubHandler(kitPath, method))
      }
    }
  }
  return out
}
