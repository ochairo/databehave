/**
 * Admin REST + UI routes. Mounted under a configurable `basePath`
 * (default `/databehave`).
 *
 *   GET    {basePath}                       — admin HTML page (UI shell)
 *   GET    {basePath}/                      — same (trailing-slash equivalent)
 *   GET    {basePath}/ui.js                 — admin UI script bundle
 *   GET    {basePath}/ui.css                — admin UI stylesheet
 *   GET    {basePath}/openapi-routes        — `{method, path, summary}[]`
 *   GET    {basePath}/openapi.json          — raw OpenAPI document (404 when not configured)
 *   GET    {basePath}/overrides             — list active sticky overrides
 *   POST   {basePath}/overrides             — add a sticky override (201)
 *   DELETE {basePath}/overrides             — clear all
 *   DELETE {basePath}/overrides/:id         — remove by id (404 if missing)
 *   GET    {basePath}/scenarios             — list saved scenarios
 *   POST   {basePath}/scenarios             — save current overrides as a scenario
 *   GET    {basePath}/scenarios/:name       — fetch a saved scenario
 *   DELETE {basePath}/scenarios/:name       — delete a saved scenario
 *   POST   {basePath}/scenarios/:name/load  — replace active overrides with the scenario
 *
 * CORS for these routes is controlled by `admin.cors`; the kit's
 * server integration injects the resolved header bag here via
 * {@link AdminRoutesOptions.corsHeaders}.
 */
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  Handler,
  MockRequest,
  MockResponse,
  RouteKey,
} from '../types.js'

import type { OverridesStore } from './overrides-store.js'
import type { ScenariosStore } from './scenarios-store.js'
import { isValidScenarioName } from './scenarios-store.js'
import type { ErrorMode, OverrideMatcher } from './admin-types.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const UI_HTML_PATH = resolve(HERE, 'ui.html')
const UI_JS_PATH = resolve(HERE, 'ui.js')
const UI_CSS_PATH = resolve(HERE, 'ui.css')

// Cached on first read — the admin bundle is static for the process lifetime.
// HTML is cached per basePath because the served body is templated with the
// base so the UI bundle and the asset <script>/<link> tags know where to
// fetch from when the UI is mounted at a non-default path.
const uiHtmlCacheByBase = new Map<string, string>()
let uiJsCache: string | undefined
let uiCssCache: string | undefined

/**
 * Inject the resolved `basePath` into the prebuilt UI shell HTML so
 * the `<script>` / `<link>` tags resolve correctly when the UI is
 * mounted at the bare base path (browsers resolve `./ui.js` against
 * the parent of the current URL, which is wrong when the URL has no
 * trailing slash) and so the UI bundle can read
 * `window.__DATABEHAVE_BASE__` to build its fetch URLs.
 */
const templateHtml = (raw: string, basePath: string): string => {
  const baseJson = JSON.stringify(basePath)
  return raw
    .replace(/src="\.\/ui\.js"/g, `src="${basePath}/ui.js"`)
    .replace(/href="\.\/ui\.css"/g, `href="${basePath}/ui.css"`)
    .replace(
      /<script type="module"/,
      `<script>window.__DATABEHAVE_BASE__=${baseJson};</script>\n  <script type="module"`,
    )
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

const validateMode = (raw: unknown): [ErrorMode | null, string | null] => {
  if (!isPlainObject(raw) || typeof raw.kind !== 'string') {
    return [null, 'mode.kind must be a string']
  }
  switch (raw.kind) {
    case 'http-status':
      if (typeof raw.status !== 'number')
        return [null, 'http-status.status must be number']
      return [{ kind: 'http-status', status: raw.status }, null]
    case 'business-failure': {
      if (typeof raw.message !== 'string')
        return [null, 'business-failure.message must be string']
      const mode: ErrorMode = { kind: 'business-failure', message: raw.message }
      if (raw.extra !== undefined) {
        if (!isPlainObject(raw.extra))
          return [null, 'business-failure.extra must be a plain object']
        ;(mode as { extra?: Record<string, unknown> }).extra = raw.extra
      }
      return [mode, null]
    }
    case 'custom-body': {
      if (!('body' in raw)) return [null, 'custom-body.body is required']
      const mode: ErrorMode = { kind: 'custom-body', body: raw.body }
      if (raw.status !== undefined) {
        if (typeof raw.status !== 'number')
          return [null, 'custom-body.status must be number']
        ;(mode as { status?: number }).status = raw.status
      }
      if (raw.contentType !== undefined) {
        if (typeof raw.contentType !== 'string')
          return [null, 'custom-body.contentType must be string']
        ;(mode as { contentType?: string }).contentType = raw.contentType
      }
      return [mode, null]
    }
    case 'empty-body': {
      const mode: ErrorMode = { kind: 'empty-body' }
      if (raw.status !== undefined) {
        if (typeof raw.status !== 'number')
          return [null, 'empty-body.status must be number']
        ;(mode as { status?: number }).status = raw.status
      }
      return [mode, null]
    }
    case 'malformed-json': {
      const mode: ErrorMode = { kind: 'malformed-json' }
      if (raw.status !== undefined) {
        if (typeof raw.status !== 'number')
          return [null, 'malformed-json.status must be number']
        ;(mode as { status?: number }).status = raw.status
      }
      return [mode, null]
    }
    case 'delay': {
      if (typeof raw.ms !== 'number' || raw.ms < 0)
        return [null, 'delay.ms must be a non-negative number']
      if (raw.then === undefined) return [{ kind: 'delay', ms: raw.ms }, null]
      const [inner, err] = validateMode(raw.then)
      if (err) return [null, `delay.then: ${err}`]
      if (
        inner!.kind === 'delay' ||
        inner!.kind === 'hang' ||
        inner!.kind === 'destroy'
      ) {
        return [null, `delay.then cannot be ${inner!.kind}`]
      }
      return [
        {
          kind: 'delay',
          ms: raw.ms,
          then: inner as Exclude<
            ErrorMode,
            { kind: 'delay' } | { kind: 'hang' } | { kind: 'destroy' }
          >,
        },
        null,
      ]
    }
    case 'hang':
      return [{ kind: 'hang' }, null]
    case 'destroy':
      return [{ kind: 'destroy' }, null]
    default:
      return [null, `unknown mode.kind: ${String(raw.kind)}`]
  }
}

const validateMatcher = (
  raw: unknown,
): [OverrideMatcher | null, string | null] => {
  if (!isPlainObject(raw) || typeof raw.kind !== 'string') {
    return [null, 'matcher.kind must be a string']
  }
  switch (raw.kind) {
    case 'exact':
      if (typeof raw.method !== 'string')
        return [null, 'matcher.method must be string']
      if (typeof raw.path !== 'string' || !raw.path.startsWith('/'))
        return [null, 'matcher.path must start with "/"']
      return [{ kind: 'exact', method: raw.method, path: raw.path }, null]
    case 'path':
      if (typeof raw.path !== 'string' || !raw.path.startsWith('/'))
        return [null, 'matcher.path must start with "/"']
      return [{ kind: 'path', path: raw.path }, null]
    case 'global': {
      if (raw.methods === undefined) return [{ kind: 'global' }, null]
      if (!Array.isArray(raw.methods))
        return [null, 'matcher.methods must be an array of strings']
      const methods: string[] = []
      for (const m of raw.methods) {
        if (typeof m !== 'string')
          return [null, 'matcher.methods must be an array of strings']
        const trimmed = m.trim()
        if (trimmed.length === 0)
          return [null, 'matcher.methods entries must be non-empty']
        methods.push(trimmed.toUpperCase())
      }
      if (methods.length === 0) return [{ kind: 'global' }, null]
      return [{ kind: 'global', methods }, null]
    }
    default:
      return [null, `unknown matcher.kind: ${String(raw.kind)}`]
  }
}

interface OpenApiDoc {
  paths?: Record<string, Record<string, { summary?: string }>>
}

export interface AdminListedRoute {
  method: string
  path: string
  summary?: string
  /**
   * Where this entry came from:
   *   - 'openapi' — derived from the configured OAS document
   *   - 'handler' — a hand-written route registered with the dispatcher
   *                 (config.routes / `endpoints`) that has no OAS entry.
   * OAS wins on duplicates so schema-rich rows take precedence in the UI.
   */
  source: 'openapi' | 'handler'
}

const buildAdminRoutesList = (
  openapiBody: string | undefined,
  handlerRoutes: ReadonlyArray<{ method: string; path: string }> | undefined,
  basePath: string,
): { routes: AdminListedRoute[]; discoveredAt: string } => {
  const out: AdminListedRoute[] = []
  const seen = new Set<string>()
  if (openapiBody !== undefined) {
    try {
      const doc = JSON.parse(openapiBody) as OpenApiDoc
      const paths = doc.paths ?? {}
      for (const [p, ops] of Object.entries(paths)) {
        for (const method of [
          'get',
          'post',
          'put',
          'delete',
          'patch',
        ] as const) {
          const op = ops[method]
          if (op !== undefined) {
            const upper = method.toUpperCase()
            seen.add(`${upper} ${p}`)
            out.push({
              method: upper,
              path: p,
              ...(typeof op.summary === 'string'
                ? { summary: op.summary }
                : {}),
              source: 'openapi',
            })
          }
        }
      }
    } catch {
      // ignore parse errors — UI will simply show an empty list.
    }
  }
  if (handlerRoutes) {
    for (const r of handlerRoutes) {
      const upper = r.method.toUpperCase()
      // Hide admin routes from the UI list — they would self-list otherwise.
      if (r.path === basePath || r.path.startsWith(`${basePath}/`)) continue
      const key = `${upper} ${r.path}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ method: upper, path: r.path, source: 'handler' })
    }
  }
  out.sort((a, b) =>
    a.path === b.path
      ? a.method.localeCompare(b.method)
      : a.path.localeCompare(b.path),
  )
  return { routes: out, discoveredAt: new Date().toISOString() }
}

export interface AdminRoutesOptions {
  readonly store: OverridesStore
  /** Mount point. Default '/databehave'. Must start with '/'. */
  readonly basePath?: string
  /** Serve the UI HTML page. Default true. */
  readonly ui?: boolean
  /** CORS headers added to every admin response. Empty = same-origin. */
  readonly corsHeaders?: Readonly<Record<string, string>>
  /** Raw OpenAPI document text — used to populate the route picker. */
  readonly openapiBody?: string
  /**
   * Route keys registered on the dispatcher (hand-written `endpoints` /
   * `config.routes`). Merged with the OAS-derived list so the admin UI
   * surfaces handler-only routes that aren't in the OpenAPI document.
   * OAS entries win on `(method, path)` collisions. Entries under
   * `basePath` are filtered to avoid self-listing the admin routes.
   */
  readonly handlerRoutes?: ReadonlyArray<{ method: string; path: string }>
  /** Optional scenarios store. When omitted, scenarios endpoints are not mounted. */
  readonly scenarios?: ScenariosStore
}

export const createAdminRoutes = (
  opts: AdminRoutesOptions,
): Partial<Record<RouteKey, Handler>> => {
  const { store, openapiBody } = opts
  const basePath = opts.basePath ?? '/databehave'
  const ui = opts.ui !== false
  const corsHeaders = opts.corsHeaders ?? {}
  const routesCache = buildAdminRoutesList(
    openapiBody,
    opts.handlerRoutes,
    basePath,
  )

  if (!basePath.startsWith('/')) {
    throw new Error(
      `@databehave/server: admin.path must start with "/" (got ${JSON.stringify(basePath)})`,
    )
  }

  const json = (status: number, body: unknown): MockResponse => ({
    status,
    json: body,
    headers: { ...corsHeaders },
  })

  const uiHandler: Handler = async () => {
    try {
      let html = uiHtmlCacheByBase.get(basePath)
      if (html === undefined) {
        const raw = await readFile(UI_HTML_PATH, 'utf8')
        html = templateHtml(raw, basePath)
        uiHtmlCacheByBase.set(basePath, html)
      }
      return { status: 200, html, headers: { ...corsHeaders } }
      /* v8 ignore start -- ui.html ships with the package; missing only on a broken install */
    } catch (err) {
      return json(500, {
        error: 'failed to read ui.html',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
    /* v8 ignore stop */
  }

  const uiJsHandler: Handler = async () => {
    try {
      if (uiJsCache === undefined) {
        uiJsCache = await readFile(UI_JS_PATH, 'utf8')
      }
      return {
        status: 200,
        text: uiJsCache,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/javascript; charset=utf-8',
        },
      }
      /* v8 ignore start -- ui.js ships with the package; missing only on a broken install */
    } catch (err) {
      return json(500, {
        error: 'failed to read ui.js',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
    /* v8 ignore stop */
  }

  const uiCssHandler: Handler = async () => {
    try {
      if (uiCssCache === undefined) {
        uiCssCache = await readFile(UI_CSS_PATH, 'utf8')
      }
      return {
        status: 200,
        text: uiCssCache,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/css; charset=utf-8',
        },
      }
      /* v8 ignore start -- ui.css ships with the package; missing only on a broken install */
    } catch (err) {
      return json(500, {
        error: 'failed to read ui.css',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
    /* v8 ignore stop */
  }

  const listRoutesHandler: Handler = () => json(200, routesCache)

  const openApiDocHandler: Handler = () => {
    if (openapiBody === undefined) {
      return json(404, { error: 'no openapi document configured' })
    }
    return {
      status: 200,
      text: openapiBody,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  }

  const listOverridesHandler: Handler = () =>
    json(200, { overrides: store.list() })

  const addOverrideHandler: Handler = async (
    req: MockRequest,
  ) => {
    let body: unknown
    try {
      body = await req.json()
    } catch (err) {
      return json(400, {
        error: 'invalid JSON body',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
    if (!isPlainObject(body))
      return json(400, { error: 'body must be a JSON object' })
    const [matcher, mErr] = validateMatcher(body.matcher)
    if (mErr) return json(400, { error: `matcher invalid: ${mErr}` })
    const [mode, modeErr] = validateMode(body.mode)
    if (modeErr) return json(400, { error: `mode invalid: ${modeErr}` })
    const description =
      typeof body.description === 'string' ? body.description : undefined
    const override = store.add({
      matcher: matcher!,
      mode: mode!,
      ...(description !== undefined ? { description } : {}),
    })
    return {
      status: 201,
      json: { id: override.id, override },
      headers: { ...corsHeaders },
    }
  }

  const removeByIdHandler: Handler = (
    req: MockRequest,
  ) => {
    const id = req.params.id
    if (!id) return json(400, { error: 'missing :id' })
    const ok = store.remove(id)
    if (!ok) return json(404, { error: 'override not found', id })
    return json(200, { deleted: true, id })
  }

  const clearAllHandler: Handler = () => {
    const n = store.clear()
    return json(200, { cleared: n })
  }

  const routes: Partial<Record<RouteKey, Handler>> = {
    [`GET ${basePath}/openapi-routes` as RouteKey]:
      listRoutesHandler,
    [`GET ${basePath}/openapi.json` as RouteKey]: openApiDocHandler,
    [`GET ${basePath}/overrides` as RouteKey]:
      listOverridesHandler,
    [`POST ${basePath}/overrides` as RouteKey]: addOverrideHandler,
    [`DELETE ${basePath}/overrides` as RouteKey]: clearAllHandler,
    [`DELETE ${basePath}/overrides/:id` as RouteKey]:
      removeByIdHandler,
  }
  if (ui) {
    // Serve the HTML shell at the bare base path AND its trailing-slash
    // variant so both `/databehave` and `/databehave/` work in a browser.
    routes[`GET ${basePath}` as RouteKey] = uiHandler
    if (!basePath.endsWith('/')) {
      routes[`GET ${basePath}/` as RouteKey] = uiHandler
    }
    routes[`GET ${basePath}/ui.js` as RouteKey] = uiJsHandler
    routes[`GET ${basePath}/ui.css` as RouteKey] = uiCssHandler
  }

  // Scenarios (file-backed snapshots of override sets). Mounted only
  // when a scenarios store is provided — pure REST CRUD plus a
  // `:name/load` action that atomically replaces the active overrides.
  const scenarios = opts.scenarios
  if (scenarios) {
    const listScenariosHandler: Handler = async () =>
      json(200, { scenarios: await scenarios.list() })

    const getScenarioHandler: Handler = async (req) => {
      const name = req.params.name ?? ''
      if (!isValidScenarioName(name))
        return json(400, { error: 'invalid scenario name' })
      const s = await scenarios.get(name)
      if (!s) return json(404, { error: 'scenario not found', name })
      return json(200, s)
    }

    const createScenarioHandler: Handler = async (req) => {
      let body: unknown
      try {
        body = await req.json()
      } catch (err) {
        return json(400, {
          error: 'invalid JSON body',
          detail: err instanceof Error ? err.message : String(err),
        })
      }
      if (!isPlainObject(body))
        return json(400, { error: 'body must be a JSON object' })
      const name = typeof body.name === 'string' ? body.name : ''
      if (!isValidScenarioName(name))
        return json(400, {
          error:
            'invalid scenario name (only [A-Za-z0-9_-], max 64 chars)',
        })
      const explicit = body.overrides
      const overrides = Array.isArray(explicit)
        ? (explicit as never[])
        : store.list()
      const saved = await scenarios.save(name, overrides)
      return {
        status: 201,
        json: saved,
        headers: { ...corsHeaders },
      }
    }

    const deleteScenarioHandler: Handler = async (req) => {
      const name = req.params.name ?? ''
      if (!isValidScenarioName(name))
        return json(400, { error: 'invalid scenario name' })
      const ok = await scenarios.remove(name)
      if (!ok) return json(404, { error: 'scenario not found', name })
      return json(200, { deleted: true, name })
    }

    const loadScenarioHandler: Handler = async (req) => {
      const name = req.params.name ?? ''
      if (!isValidScenarioName(name))
        return json(400, { error: 'invalid scenario name' })
      const s = await scenarios.get(name)
      if (!s) return json(404, { error: 'scenario not found', name })
      store.clear()
      const loaded: string[] = []
      for (const o of s.overrides) {
        const added = store.add({
          matcher: o.matcher,
          mode: o.mode,
          ...(o.description !== undefined
            ? { description: o.description }
            : {}),
        })
        loaded.push(added.id)
      }
      return json(200, { loaded: loaded.length, name })
    }

    routes[`GET ${basePath}/scenarios` as RouteKey] =
      listScenariosHandler
    routes[`GET ${basePath}/scenarios/:name` as RouteKey] =
      getScenarioHandler
    routes[`POST ${basePath}/scenarios` as RouteKey] =
      createScenarioHandler
    routes[
      `DELETE ${basePath}/scenarios/:name` as RouteKey
    ] = deleteScenarioHandler
    routes[
      `POST ${basePath}/scenarios/:name/load` as RouteKey
    ] = loadScenarioHandler
  }

  return routes
}
