import type { ObservedMethod, MockRequest } from './types.js'

/**
 * Per-request body cache shared across every `MockRequest` facade
 * built from the same underlying web `Request`. Routing may rebuild
 * the facade (e.g. once for the dispatch probe with empty `params`,
 * then again with the resolved path params), and we want
 * `req.json()` / `req.text()` to read the body once across all of
 * them. Keyed on the underlying web `Request` so it gets GC'd when
 * the request ends.
 */
const bodyCache = new WeakMap<globalThis.Request, Promise<string>>()

/**
 * Build a `MockRequest` from a web standard `Request`.
 *
 * Headers are lower-cased. Query keys are deduplicated for the
 * `query` map (last value wins) but kept whole in `queryAll`.
 * `params` is supplied by the router after a successful pattern
 * match; for static routes the caller passes `{}`.
 *
 * `json()` / `text()` share one lazy body read across **every facade
 * built from the same web `Request`** — calling either twice does not
 * re-clone the underlying web `Request`, and the router rebuilding
 * the facade for a parameterised route doesn't trigger a second clone.
 * `raw()` returns the underlying web `Request`; consuming its body
 * directly and then calling `json()` / `text()` will throw, matching
 * the web standard.
 */
export const buildRequest = (
  req: globalThis.Request,
  params: Readonly<Record<string, string>> = {},
): MockRequest => {
  const url = new URL(req.url)
  const method = req.method.toLowerCase() as ObservedMethod

  const queryAll: Record<string, string[]> = {}
  for (const [k, v] of url.searchParams.entries()) {
    ;(queryAll[k] ??= []).push(v)
  }
  const query: Record<string, string> = {}
  for (const [k, vs] of Object.entries(queryAll)) {
    const last = vs[vs.length - 1]
    if (last !== undefined) query[k] = last
  }

  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })

  const text = (): Promise<string> => {
    const cached = bodyCache.get(req)
    if (cached) return cached
    const fresh = req.clone().text()
    bodyCache.set(req, fresh)
    return fresh
  }

  return {
    method,
    url: req.url,
    path: url.pathname,
    query,
    queryAll,
    params,
    headers,
    json: <T = unknown>() => text().then((t) => JSON.parse(t) as T),
    text,
    raw: () => req,
  }
}
