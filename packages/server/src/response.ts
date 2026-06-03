import type { MockResponse } from './types.js'

/**
 * Serialize a `MockResponse` POJO into a web standard `Response`.
 *
 * Body variant selection is exhaustive — TypeScript will catch a
 * missing branch if a new variant is added to `MockResponseBody`.
 *
 * User-supplied `headers` are merged on top of the defaults derived
 * from the body variant (e.g. `Content-Type: application/json`), so
 * a handler can override `Content-Type` when needed.
 */
export const buildResponse = (res: MockResponse): globalThis.Response => {
  const status = res.status ?? 200
  const headers = new Headers()

  let body: BodyInit | null

  if ('empty' in res && res.empty === true) {
    body = null
  } else if ('json' in res && res.json !== undefined) {
    headers.set('content-type', 'application/json; charset=utf-8')
    body = JSON.stringify(res.json)
  } else if ('text' in res && res.text !== undefined) {
    headers.set('content-type', 'text/plain; charset=utf-8')
    body = res.text
  } else if ('html' in res && res.html !== undefined) {
    headers.set('content-type', 'text/html; charset=utf-8')
    body = res.html
  } else if ('raw' in res && res.raw !== undefined) {
    body = res.raw
  } else {
    throw new Error(
      '@databehave/server: response body variant missing — set one of json / text / html / raw / empty',
    )
  }

  if (res.headers) {
    for (const [k, v] of Object.entries(res.headers)) {
      headers.set(k.toLowerCase(), v)
    }
  }

  return new Response(body, { status, headers })
}
