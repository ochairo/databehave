import {
  createServer as createNodeHttpServer,
  type IncomingMessage,
  type Server as NodeHttpServer,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'

import { createAdminRoutes } from './admin/admin-routes.js'
import {
  AdminDestroySocketSignal,
  type AdminModeConfig,
} from './admin/admin-types.js'
import { emitAdminBanner } from './admin/banner.js'
import { createInjectHook, isDestroySocketSentinel } from './admin/inject.js'
import { createOverridesStore } from './admin/overrides-store.js'
import { resolveAdminCors } from './admin/resolve-cors.js'
import { createScenariosStore } from './admin/scenarios-store.js'
import { buildCorsResponseHeaders, buildPreflightResponse, mergeVary } from './cors.js'
import { createAccessLogger } from './log.js'
import {
  createRequestValidationContext,
  validateRequest,
  type RequestValidationContext,
} from './middleware/request-validation.js'
import { parseOpenApi } from './openapi/loader.js'
import { buildOpenApiRoutes } from './openapi/register.js'
import { buildRequest } from './request.js'
import { buildResponse } from './response.js'
import { matchPattern, parseRouteKey, parseRoutePattern } from './route-key.js'
import type { RoutePattern } from './route-key.js'
import type {
  Config,
  Handler,
  ListenHandle,
  ListenOptions,
  Method,
  MockRequest,
  MockResponse,
  ObservedMethod,
  RouteKey,
  Server,
} from './types.js'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

/**
 * Resolve admin config defaults + validate inputs that don't
 * depend on listen() host. Returns `null` when admin is absent or
 * `enabled !== true`. Pure — no side effects.
 */
export const resolveAdminMode = (
  cfg: AdminModeConfig | undefined,
): {
  path: string
  ui: boolean
  headers: boolean
  bind: 'loopback-only' | 'any'
  cors: NonNullable<AdminModeConfig['cors']>
  allowDestroy: boolean
  openapiBody: string | undefined
  scenariosDir: string
} | null => {
  if (!cfg || cfg.enabled !== true) return null
  const path = cfg.path ?? '/databehave'
  if (!path.startsWith('/')) {
    throw new Error(
      `@databehave/server: admin.path must start with "/" (got ${JSON.stringify(path)})`,
    )
  }
  return {
    path,
    ui: cfg.ui !== false,
    headers: cfg.headers !== false,
    bind: cfg.bind ?? 'loopback-only',
    cors: cfg.cors ?? 'auto',
    allowDestroy: cfg.allowDestroy !== false,
    openapiBody: cfg.openapiBody,
    scenariosDir: cfg.scenariosDir ?? `${process.cwd()}/mock-scenarios`,
  }
}

/**
 * Compose two onRequest hooks (user-first per spec H13): if the user
 * hook returned a response, skip the admin inject hook; else call
 * inject. Exported for unit testability.
 */
export const composeAdminOnRequest = (
  userHook:
    | ((
        req: MockRequest,
      ) => MockResponse | void | Promise<MockResponse | void>)
    | undefined,
  adminHook: (
    req: MockRequest,
  ) => Promise<MockResponse | void>,
): ((
  req: MockRequest,
) => Promise<MockResponse | void>) => {
  if (!userHook) return adminHook
  return async (req) => {
    const first = await userHook(req)
    if (first) return first
    return adminHook(req)
  }
}

interface DynamicRoute {
  readonly method: Method
  readonly pattern: RoutePattern
  readonly handler: Handler
}

interface RouteIndex {
  /** Exact `'method path'` → handler. O(1) lookup, the common case. */
  readonly statik: Map<string, Handler>
  /**
   * Dynamic patterns scanned in declaration order. Each entry is
   * tried only after the static lookup misses, so per-request cost
   * for an all-static config stays O(1).
   */
  readonly dynamic: readonly DynamicRoute[]
}

const buildRouteIndex = (config: Config): RouteIndex => {
  const statik = new Map<string, Handler>()
  const dynamic: DynamicRoute[] = []
  const declared = new Set<string>()
  const declaredKeys = new Set<RouteKey>()

  const entries = Object.entries(config.routes ?? {}) as Array<
    [RouteKey, Handler | undefined]
  >
  for (const [key, handler] of entries) {
    if (!handler) continue
    const { method, path } = parseRouteKey(key)
    const pattern = parseRoutePattern(path)
    const dispatchKey = `${method} ${path}`
    if (declared.has(dispatchKey)) {
      throw new Error(`@databehave/server: duplicate route declared: ${dispatchKey}`)
    }
    declared.add(dispatchKey)
    declaredKeys.add(`${method.toUpperCase()} ${path}` as RouteKey)
    if (pattern.isStatic) {
      statik.set(dispatchKey, handler)
    } else {
      dynamic.push({ method, pattern, handler })
    }
  }

  // OpenAPI walker fills only the gaps the user did NOT declare.
  // Declared (hand-written) routes always win — no error, just skip.
  if (config.openapi !== undefined) {
    const doc = parseOpenApi(config.openapi)
    const oasRoutes = buildOpenApiRoutes(doc, {
      skip: declaredKeys,
      ...(config.onOpenApiWalkError !== undefined
        ? { onWalkError: config.onOpenApiWalkError }
        : {}),
      ...(config.onOpenApiEmptySchema !== undefined
        ? { onEmptySchema: config.onOpenApiEmptySchema }
        : {}),
    })
    for (const [key, handler] of oasRoutes) {
      const { method, path } = parseRouteKey(key)
      const pattern = parseRoutePattern(path)
      const dispatchKey = `${method} ${path}`
      if (declared.has(dispatchKey)) continue
      declared.add(dispatchKey)
      if (pattern.isStatic) {
        statik.set(dispatchKey, handler)
      } else {
        dynamic.push({ method, pattern, handler })
      }
    }
  }

  return { statik, dynamic }
}

interface Matched {
  readonly handler: Handler
  readonly params: Readonly<Record<string, string>>
}

const dispatch = (
  index: RouteIndex,
  method: ObservedMethod,
  path: string,
): Matched | null => {
  const staticHit = index.statik.get(`${method} ${path}`)
  if (staticHit) return { handler: staticHit, params: {} }
  for (const route of index.dynamic) {
    if (route.method !== method) continue
    const params = matchPattern(route.pattern, path)
    if (params) return { handler: route.handler, params }
  }
  return null
}

/**
 * Build a @databehave/server server.
 *
 * Construction validates every route key and pre-computes a dispatch
 * index (static lookups are O(1), `:param` patterns are linear). The
 * returned object exposes:
 *
 * - `fetch(Request)` for in-process testing — no socket is opened.
 * - `listen({port, host})` to bind a Node HTTP server. Port `0`
 *   asks the OS for a free port; the resolved port/host come back in
 *   the handle.
 *
 * Request flow per call:
 *   1. CORS preflight (OPTIONS) → short-circuit when `cors` is set
 *   2. `hooks.onRequest` → may short-circuit
 *   3. Route dispatch → handler / OAS walker / 404
 *   4. `hooks.onResponse` → may replace the result
 *   5. CORS response headers merged on top (don't override the user)
 *   6. Handler errors funnel through `hooks.onError` or fall back
 *      to a 500 JSON envelope.
 */
/**
 * Route a runtime `'error'` event from a bound Node `http.Server` to
 * the user-supplied `onServerError` hook (when present), with a
 * `console.error` fallback. Exported so the branching is unit-testable
 * without standing up a real socket and provoking EMFILE/EACCES.
 *
 * Branch contract:
 *   - no hook              → log via `console.error`
 *   - hook returns         → silent (hook owns reporting)
 *   - hook itself throws   → log the *hook* failure AND the original
 *                            error, so a misbehaving logger never
 *                            silently swallows a real server fault.
 */
export const handleRuntimeServerError = (
  err: Error,
  onServerError: ((err: Error) => void) | undefined,
): void => {
  if (onServerError) {
    try {
      onServerError(err)
      return
    } catch (hookErr) {
      // eslint-disable-next-line no-console
      console.error('[@databehave/server] onServerError hook threw:', hookErr)
    }
  }
  // eslint-disable-next-line no-console
  console.error('[@databehave/server] server error:', err)
}

export const createServer = (config: Config): Server => {
  const admin = resolveAdminMode(config.admin)
  let effectiveConfig: Config = config

  if (admin) {
    const store = createOverridesStore({
      warn: (m: string) => console.warn(m),
    })
    const corsHeaders = resolveAdminCors(admin.bind, admin.cors)
    const scenarios = createScenariosStore({ dir: admin.scenariosDir })
    // Surface hand-written routes to the admin UI so handler-only
    // endpoints (those not in the OAS doc, or projects without one)
    // still appear in the operation list. OAS entries win on dedupe
    // inside `buildAdminRoutesList`; admin's own routes are filtered
    // there too. OAS-walker output is already covered by `openapiBody`.
    const handlerRoutes: Array<{ method: string; path: string }> = []
    for (const key of Object.keys(config.routes ?? {}) as RouteKey[]) {
      try {
        const { method, path } = parseRouteKey(key)
        handlerRoutes.push({ method: method.toUpperCase(), path })
      } catch {
        // buildRouteIndex below will surface invalid keys with a real error.
      }
    }
    const adminRouteEntries = createAdminRoutes({
      store,
      basePath: admin.path,
      ui: admin.ui,
      corsHeaders,
      scenarios,
      handlerRoutes,
      ...(admin.openapiBody !== undefined
        ? { openapiBody: admin.openapiBody }
        : {}),
    })

    // Fail-fast on conflict between admin routes and user routes —
    // duplicates would silently shadow each other otherwise.
    const userRoutes = config.routes ?? {}
    for (const key of Object.keys(adminRouteEntries)) {
      if (Object.prototype.hasOwnProperty.call(userRoutes, key)) {
        throw new Error(
          `@databehave/server: admin route ${key} collides with a user-declared route. ` +
            `Move admin.path to a free prefix or rename the user route.`,
        )
      }
    }

    // Inject hook is only registered when `headers` is true OR there
    // can be sticky overrides — and stickies require the admin REST
    // endpoints, which are always present, so the hook is always
    // useful here. The `headers` flag is honored inside the inject
    // hook by feeding it an empty-header view when disabled.
    const adminHookCore = createInjectHook({
      store,
      allowDestroy: admin.allowDestroy,
      // Bypass both the bare base path (admin HTML) and any descendant
      // (`/overrides`, `/ui.js`, …) so the inject hook never injects on
      // admin-owned URLs.
      bypassPathPrefixes: [admin.path],
      logger: { warn: (m: string) => console.warn(m) },
    })
    const adminHook = admin.headers
      ? adminHookCore
      : async (req: MockRequest) =>
          adminHookCore({ ...req, headers: {} } as MockRequest)

    const userHook = config.hooks?.onRequest
    const composed = composeAdminOnRequest(userHook, adminHook)

    effectiveConfig = {
      ...config,
      routes: { ...userRoutes, ...adminRouteEntries },
      hooks: { ...(config.hooks ?? {}), onRequest: composed },
    }
  }

  const index = buildRouteIndex(effectiveConfig)
  const hooks = effectiveConfig.hooks ?? {}
  const cors = effectiveConfig.cors
  const accessLogger = createAccessLogger(effectiveConfig.log, admin?.path)

  // Build the request-validation context once per server boot. When
  // `validation.request !== true` (the default) the context is null
  // and the per-request hot path short-circuits.
  //
  // Schema-level errors (unsupported keyword, $ref cycle, ReDoS-sized
  // pattern, depth-cap exceeded) throw at boot from
  // `createRequestValidationContext` so a misconfigured spec is a
  // fail-fast — never a silent runtime degradation.
  let validationCtx: RequestValidationContext | null = null
  if (effectiveConfig.validation?.request === true && effectiveConfig.openapi !== undefined) {
    const doc = parseOpenApi(effectiveConfig.openapi)
    const maxBodyBytes = effectiveConfig.validation?.maxBodyBytes
    validationCtx = createRequestValidationContext(
      doc as Parameters<typeof createRequestValidationContext>[0],
      maxBodyBytes !== undefined ? { maxBodyBytes } : {},
    )
  }

  const decorateWithCors = (
    res: MockResponse,
    req: MockRequest,
  ): MockResponse => {
    if (!cors) return res
    const corsHeaders = buildCorsResponseHeaders(cors, req)
    // Handler-supplied headers win — CORS only fills the gaps. `Vary`
    // is the deliberate exception: HTTP semantics require it to be
    // additive, so a handler-set `Vary: Accept-Encoding` is merged
    // with the CORS `Vary: Origin` (case-insensitive dedupe) rather
    // than silently replacing it.
    const merged: Record<string, string> = { ...corsHeaders }
    if (res.headers) {
      for (const [k, v] of Object.entries(res.headers)) {
        const lk = k.toLowerCase()
        if (lk === 'vary') {
          merged.vary = mergeVary(merged.vary, v)
        } else {
          merged[lk] = v
        }
      }
    }
    return { ...res, headers: merged }
  }

  const fetchImpl = async (
    req: globalThis.Request,
    suppressLog = false,
  ): Promise<globalThis.Response> => {
    const probe = buildRequest(req)
    const logStart =
      accessLogger && !suppressLog ? Date.now() : 0
    const finalize = (res: globalThis.Response, errorMsg?: string): globalThis.Response => {
      if (!accessLogger || suppressLog) return res
      accessLogger.emit({
        method: probe.method.toUpperCase(),
        path: probe.path,
        status: res.status,
        ms: Date.now() - logStart,
        bytes: res.headers.get('content-length') ?? '-',
        override: res.headers.get('x-mock-injected')?.split(':')[0],
        error: errorMsg,
      })
      return res
    }

    // 1. CORS preflight bypasses everything below.
    if (cors && req.method.toUpperCase() === 'OPTIONS') {
      return finalize(buildResponse(buildPreflightResponse(cors, probe)))
    }

    // 1a. Inbound request validation (opt-in via
    // `config.validation.request`). Runs BEFORE mock/handler
    // resolution so a request that fails the OAS contract is rejected
    // with an RFC 7807 envelope without invoking handlers, hooks, or
    // mock-mode injection. When `validationCtx` is null (the default)
    // the function short-circuits and behaviour is byte-identical to
    // pre-validation builds.
    if (validationCtx) {
      const violation = await validateRequest(req, validationCtx)
      if (violation) return finalize(violation)
    }

    // 1b. RFC 7231 HEAD semantics: if the HEAD route is not declared,
    // run the GET pipeline once and strip the body from the response.
    // Hooks (`onRequest`, `onResponse`, mock-mode) fire on the inner
    // GET call only — the outer HEAD short-circuits here before the
    // `try` block, so they aren't observed twice for one logical
    // request. Explicit `head` routes still take precedence (handled
    // by `dispatch` for the original method).
    if (
      req.method.toUpperCase() === 'HEAD' &&
      !dispatch(index, 'head', probe.path)
    ) {
      const asGet = new Request(req.url, {
        method: 'GET',
        headers: req.headers,
      })
      // Inner GET is recursed with logging suppressed so the access
      // logger emits one line per logical request — for the outer
      // HEAD method, not the synthetic GET probe.
      const fullResponse = await fetchImpl(asGet, true)
      return finalize(
        new Response(null, {
          status: fullResponse.status,
          headers: fullResponse.headers,
        }),
      )
    }

    try {
      // 2. onRequest may short-circuit (e.g. mock-mode error injection).
      if (hooks.onRequest) {
        const short = await hooks.onRequest(probe)
        if (short) {
          // admin destroy sentinel: bubble up so `listen()` can drop the
          // underlying socket. `server.fetch()` callers observe the
          // throw — destroy is a transport-level signal, not a body.
          if (isDestroySocketSentinel(short)) {
            throw new AdminDestroySocketSignal()
          }
          const final = hooks.onResponse
            ? (await hooks.onResponse(probe, short)) ?? short
            : short
          return finalize(buildResponse(decorateWithCors(final, probe)))
        }
      }

      // 3. Dispatch.
      const matched = dispatch(index, probe.method, probe.path)
      if (!matched) {
        const notFound: MockResponse = {
          status: 404,
          json: { error: 'not_found', method: probe.method, path: probe.path },
        }
        const final = hooks.onResponse
          ? (await hooks.onResponse(probe, notFound)) ?? notFound
          : notFound
        return finalize(buildResponse(decorateWithCors(final, probe)))
      }
      const kitReq =
        Object.keys(matched.params).length === 0
          ? probe
          : buildRequest(req, matched.params)
      const raw = await matched.handler(kitReq)

      // 4. onResponse may replace the body / status / headers.
      const final = hooks.onResponse
        ? (await hooks.onResponse(kitReq, raw)) ?? raw
        : raw

      return finalize(buildResponse(decorateWithCors(final, kitReq)))
    } catch (err) {
      // Admin destroy signal must escape — hooks.onError must NOT see
      // it (it's transport-level, not a user error). `listen()` catches
      // it specifically. `server.fetch()` callers also receive the throw.
      if (err instanceof AdminDestroySocketSignal) throw err
      const errMsg = err instanceof Error ? err.message : String(err)
      const errRes = hooks.onError
        ? await hooks.onError(probe, err)
        : ({
            status: 500,
            json: {
              error: 'internal_error',
              message: errMsg,
            },
          } satisfies MockResponse)
      return finalize(buildResponse(decorateWithCors(errRes, probe)), errMsg)
    }
  }

  const fetch = (req: globalThis.Request): Promise<globalThis.Response> => fetchImpl(req)

  const listen = async (
    opts: ListenOptions = {},
  ): Promise<ListenHandle> => {
    const requestedPort = opts.port ?? 0
    const requestedHost = opts.host ?? '127.0.0.1'

    // Admin bind-policy: refuse non-loopback hosts unless explicitly
    // opted in. Host comes from listen options (not config), so the
    // check belongs here rather than at server construction time.
    if (admin && admin.bind !== 'any' && !LOOPBACK_HOSTS.has(requestedHost)) {
      throw new Error(
        `@databehave/server: admin is enabled and server.host=${JSON.stringify(
          requestedHost,
        )} — set admin.bind: "any" to confirm this is intentional, or bind to loopback (127.0.0.1, ::1, localhost). See README "Admin mode".`,
      )
    }

    // Tiny Node `http` ↔ Web Fetch adapter. Node ≥ 18.17 provides
    // `Request`, `Response`, `Headers`, and `Readable.{toWeb,fromWeb}`
    // as built-ins, so no polyfill or extra runtime dependency is needed.
    const server = createNodeHttpServer((req: IncomingMessage, res: ServerResponse) => {
      // Build a Web Request out of the IncomingMessage.
      const host = req.headers.host ?? `${requestedHost}:${requestedPort}`
      const url = `http://${host}${req.url ?? '/'}`
      const method = (req.method ?? 'GET').toUpperCase()
      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue
        if (Array.isArray(v)) {
          for (const value of v) headers.append(k, value)
        } else {
          headers.set(k, v)
        }
      }
      const init: RequestInit & { duplex?: 'half' } = { method, headers }
      if (method !== 'GET' && method !== 'HEAD') {
        init.body = Readable.toWeb(req) as unknown as BodyInit
        // Required when sending a stream body in undici/fetch.
        init.duplex = 'half'
      }

      Promise.resolve()
        .then(() => fetch(new Request(url, init)))
        .then(async (webRes) => {
          res.statusCode = webRes.status
          webRes.headers.forEach((value, key) => {
            res.setHeader(key, value)
          })
          if (!webRes.body) {
            res.end()
            return
          }
          const nodeStream = Readable.fromWeb(
            webRes.body as Parameters<typeof Readable.fromWeb>[0],
          )
          await new Promise<void>((resolveStream, rejectStream) => {
            nodeStream.on('error', rejectStream)
            res.on('error', rejectStream)
            res.on('finish', () => resolveStream())
            nodeStream.pipe(res)
          })
        })
        .catch((err: unknown) => {
          // Admin destroy: drop the socket without a response.
          if (err instanceof AdminDestroySocketSignal) {
            try {
              req.socket.destroy()
            } catch {
              /* socket may already be gone */
            }
            return
          }
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('content-type', 'application/json')
          }
          const message = err instanceof Error ? err.message : String(err)
          res.end(JSON.stringify({ error: 'internal_error', message }))
        })
    })

    return new Promise<ListenHandle>((resolve, reject) => {
      const onBindError = (err: Error): void => {
        reject(err)
      }
      server.once('error', onBindError)
      server.listen(requestedPort, requestedHost, () => {
        // Bind succeeded — detach the bind-time rejector so subsequent
        // runtime errors (EMFILE, accept errors, etc.) don't try to
        // resolve an already-settled promise. Surface them on stderr
        // instead so they're not swallowed silently.
        server.removeListener('error', onBindError)
        server.on('error', (err) => handleRuntimeServerError(err, hooks.onServerError))
        const info = server.address() as AddressInfo
        if (admin) {
          emitAdminBanner(info.address, info.port, admin.path)
        }
        resolve({
          port: info.port,
          host: info.address,
          close: () =>
            new Promise<void>((res, rej) => {
              server.close((err) => (err ? rej(err) : res()))
            }),
        })
      })
    })
  }

  return { fetch, listen }
}
