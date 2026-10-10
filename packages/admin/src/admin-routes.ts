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
} from '@databehave/server'

import type { ScenariosStore } from './scenarios.js'
import { isValidScenarioName, validateScenario, isPlainObject, validateMatcher, validateMode, validateOverrides, validateScenarioVersion, ScenarioValidationError } from './validation.js'
import type { ResolvedRoute } from '@databehave/server'
import type { FaultControl } from './fault-plugin.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const UI_HTML_PATH = resolve(HERE, '../assets/ui.html')
const UI_JS_PATH = resolve(HERE, '../assets/ui.js')
const UI_CSS_PATH = resolve(HERE, '../assets/ui.css')

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

/** Internal HTTP adapter options; the plugin owns registration and dependencies. */
export interface AdminRoutesOptions {
  readonly store: Pick<FaultControl, 'add' | 'remove' | 'list' | 'clear' | 'replace'>
  /** Mount point. Default '/databehave'. Must start with '/'. */
  readonly basePath?: string
  /** Serve the UI HTML page. Default true. */
  readonly ui?: boolean
  /** CORS headers added to every admin response. Empty = same-origin. */
  readonly corsHeaders?: Readonly<Record<string, string>>
  /** Raw OpenAPI document text — used to populate the route picker. */
  readonly openapiBody?: () => string | undefined
  /** Resolved HTTP routes; read only after HTTP activation. */
  readonly catalog?: () => readonly ResolvedRoute[]
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

  if (!basePath.startsWith('/')) {
    throw new Error(
      `@databehave/admin: admin.path must start with "/" (got ${JSON.stringify(basePath)})`,
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

  const listRoutesHandler: Handler = () => json(200, {
    features: { scenarios: opts.scenarios !== undefined },
    routes: (opts.catalog?.() ?? [])
      .filter((route) => route.path !== basePath && !route.path.startsWith(`${basePath}/`))
      .map((route) => ({ method: route.method.toUpperCase(), path: route.path,
        source: route.source === 'openapi' ? 'openapi' : 'handler',
        ...(typeof route.metadata?.summary === 'string' ? { summary: route.metadata.summary } : {}),
      })).sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)),
    discoveredAt: new Date().toISOString(),
  })

  const openApiDocHandler: Handler = () => {
    const document = openapiBody?.()
    if (document === undefined) {
      return json(404, { error: 'no openapi document configured' })
    }
    return {
      status: 200,
      text: document,
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
    if (!matcher) return json(400, { error: `matcher invalid: ${mErr}` })
    const [mode, modeErr] = validateMode(body.mode)
    if (!mode) return json(400, { error: `mode invalid: ${modeErr}` })
    const description =
      typeof body.description === 'string' ? body.description : undefined
    const override = store.add({
      matcher,
      mode,
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

  // Scenarios (snapshots persisted by the supplied store). Mounted only
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
      if (s === null) return json(404, { error: 'scenario not found', name })
      return json(200, validateScenario(s, name))
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
      let overrides: ReturnType<typeof validateOverrides>
      try {
        validateScenarioVersion(body.version)
        overrides = validateOverrides(body.overrides === undefined ? store.list() : body.overrides)
      } catch (error) {
        if (error instanceof ScenarioValidationError) return json(400, { error: error.message })
        throw error
      }
      const saved = validateScenario(await scenarios.save(name, overrides), name)
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
      if (s === null) return json(404, { error: 'scenario not found', name })
      const validated = validateScenario(s, name)
      const loaded = store.replace(validated.overrides).map((override) => override.id)
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

  for (const key of Object.keys(routes) as RouteKey[]) {
    const handler = routes[key]
    if (handler) routes[key] = async (request) => {
      try { return await handler(request) }
      catch (error) {
        if (error instanceof ScenarioValidationError) return json(400, { error: error.message })
        throw error
      }
    }
  }
  return routes
}
