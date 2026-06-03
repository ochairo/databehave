import type { RouteSummary, ScenarioSummary, StickyOverride } from './types'

declare global {
  interface Window {
    __DATABEHAVE_BASE__?: string
  }
}

/**
 * Resolved base path for admin REST calls. Injected at serve time by
 * `admin-routes.ts` (which templates `window.__DATABEHAVE_BASE__` into
 * the HTML shell so the UI knows where its REST is mounted, regardless
 * of `admin.path`). Falls back to `''` (same-origin root) for
 * dev / standalone use.
 */
const BASE =
  (typeof window !== 'undefined' && window.__DATABEHAVE_BASE__) || ''

/**
 * Module-scoped cache for the parsed OpenAPI document. `undefined`
 * means "not yet fetched"; `null` means "fetched, not available".
 * The doc is static for the process lifetime, so a single fetch is
 * enough for every component mount.
 */
let openApiCache: unknown | null | undefined = undefined

const json = async <T>(res: Response): Promise<T> => {
  const text = await res.text()
  const body = text ? (JSON.parse(text) as T) : (undefined as unknown as T)
  if (!res.ok) {
    const detail =
      typeof body === 'object' && body !== null
        ? (body as { error?: string }).error
        : undefined
    throw new Error(detail ?? `HTTP ${res.status}`)
  }
  return body
}

export const api = {
  async listOverrides(): Promise<StickyOverride[]> {
    const res = await fetch(BASE + '/overrides')
    const body = await json<{ overrides: StickyOverride[] }>(res)
    return body.overrides ?? []
  },
  async addOverride(input: Pick<StickyOverride, 'matcher' | 'mode' | 'description'>): Promise<StickyOverride> {
    const res = await fetch(BASE + '/overrides', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    const body = await json<{ id: string; override: StickyOverride }>(res)
    return body.override
  },
  async removeOverride(id: string): Promise<void> {
    await json<unknown>(await fetch(BASE + '/overrides/' + encodeURIComponent(id), { method: 'DELETE' }))
  },
  async clearOverrides(): Promise<void> {
    await json<unknown>(await fetch(BASE + '/overrides', { method: 'DELETE' }))
  },
  async listRoutes(): Promise<RouteSummary[]> {
    const res = await fetch(BASE + '/openapi-routes')
    const body = await json<{ routes: RouteSummary[] }>(res)
    return body.routes ?? []
  },
  async fetchOpenApi(): Promise<unknown | null> {
    // Best-effort: the kit serves the raw OAS document at
    // `{admin.path}/openapi.json` when configured with `openapi`.
    // We cache the first successful (or null) result for the page
    // lifetime — the doc is static for the process. On 404 / network
    // error we resolve to `null` so components render without schema
    // detail (no error toast — it's optional).
    if (openApiCache !== undefined) return openApiCache
    try {
      const res = await fetch(BASE + '/openapi.json')
      if (!res.ok) {
        openApiCache = null
        return null
      }
      openApiCache = (await res.json()) as unknown
      return openApiCache
    } catch {
      openApiCache = null
      return null
    }
  },
  async listScenarios(): Promise<ScenarioSummary[]> {
    const res = await fetch(BASE + '/scenarios')
    if (res.status === 404) return []
    const body = await json<{ scenarios: ScenarioSummary[] }>(res)
    return body.scenarios ?? []
  },
  async saveScenario(name: string): Promise<void> {
    await json<unknown>(
      await fetch(BASE + '/scenarios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    )
  },
  async loadScenario(name: string): Promise<void> {
    await json<unknown>(
      await fetch(BASE + '/scenarios/' + encodeURIComponent(name) + '/load', { method: 'POST' }),
    )
  },
  async deleteScenario(name: string): Promise<void> {
    await json<unknown>(
      await fetch(BASE + '/scenarios/' + encodeURIComponent(name), { method: 'DELETE' }),
    )
  },
}

export type AdminApi = typeof api
