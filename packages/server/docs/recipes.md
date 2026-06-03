# Recipes

Practical patterns for common mocking problems. Each example is
self-contained and runnable against the public surface.

## Static health endpoint

```jsonc
"endpoints": {
  "GET /health": {
    "response": {
      "status": 200,
      "json":   { "ok": true }
    }
  }
}
```

No handler module to write, no OAS entry needed. Add the path to
`mockMode.healthPaths` so `mockMode` does not inject an error status
into your probes:

```jsonc
"mockMode": {
  "enabled": true,
  "healthPaths": ["/health"]
}
```

## Force a single endpoint to 500

```jsonc
"endpoints": {
  "POST products/bulk-update": {
    "handler": "./src/routes/bulk-update.js",
    "status": 500
  }
}
```

The handler still loads (and stays valid for tests that call it
directly), but live HTTP requests get a 500 with the OAS-derived
error body. To remove the override, delete the `status` field.

## Force every endpoint to 500 (chaos mode)

```jsonc
"mockMode": {
  "enabled":       true,
  "defaultStatus": 500,
  "healthPaths":   ["/health"]
}
```

Health probes pass through, everything else returns 500 with the
OAS-derived error body. Useful for client-side error-path testing.

## In-process testing with `fetch()`

```ts
import { describe, it, expect } from 'vitest'
import { createServer } from '@databehave/server'
import { loadConfig } from '@databehave/server'

describe('mock server', () => {
  it('serves the OAS-derived east inventory', async () => {
    const { config } = await loadConfig('./databehave.jsonc')
    const server = createServer(config)

    const res = await server.fetch(
      new Request(
        'http://localhost/api/v1/products/list?date_from=2024-01-01',
      ),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('x-mock-status')).toBe('200')
    const body = await res.json()
    expect(body).toHaveProperty('result')
  })
})
```

No sockets, no `listen()`. The same `Request` URL always yields the
same JSON body — assert against it directly or use a snapshot.

## Auth short-circuit via `hooks.onRequest`

```ts
import { createServer } from '@databehave/server'

const server = createServer({
  routes: { /* ... */ },
  hooks: {
    onRequest: (req) => {
      if (req.headers.authorization !== 'Bearer test-token') {
        return { status: 401, json: { error: 'unauthorized' } }
      }
      // returning void → continue to the route handler
    },
  },
})
```

The handler is never reached for requests without the token. Pair
with `mockMode.healthPaths` if you want probes to bypass auth.

## Inject a header on every response

```ts
createServer({
  routes: { /* ... */ },
  hooks: {
    onResponse: (_req, res) => ({
      ...res,
      headers: { ...(res.headers ?? {}), 'x-build-id': process.env.BUILD_ID ?? 'local' },
    }),
  },
})
```

`onResponse` runs after the handler but before the runtime adapts the
POJO into a web `Response`.

## Generate deterministic bodies with `databehave`

```ts
// src/routes/products/list.ts
import { mock, obj, str, decimal, arr, seedFor } from '@databehave/server'
import type { Handler } from '@databehave/server'

const Product = obj({
  category: str().in(['books', 'movies']),
  price:    decimal(10, 2).min('0').max('1000').typically(400, 700),
})

const Body = obj({ result: arr(Product).length(48) })

const handler: Handler = (req) => {
  const seed = seedFor({
    endpoint: '/api/v1/products/list',
    extra: Object.fromEntries(new URL(req.url).searchParams),
  })
  return { json: mock(Body, { seed }) }
}

export default handler
```

Same URL → same body. `databehave` is re-exported from `@databehave/server` so a
single import covers schema authoring and server wiring.

## Per-variant sub-routes (one handler each — no shared helpers)

When granularity matters, write each endpoint as a separate handler
with its own seed namespace. Do **not** extract a helper that loops
over variants — you lose the ability to tune `min` / `max` / `typically`
per endpoint without disturbing the others.

```jsonc
"endpoints": {
  "GET products/list":  "./src/routes/products/list.js",
  "GET products/featured":  "./src/routes/products/featured.js",
  "GET products/summary": "./src/routes/products/summary.js"
}
```

Each handler controls its own `min` / `max` / `typically` ranges
independently.

## Custom CORS origin reflector

The JSONC form mirrors the request `Origin` by default. To customise:

```ts
createServer({
  routes: { /* ... */ },
  cors: {
    origin: (o) => (o.endsWith('.example.com') ? o : 'https://app.example.com'),
    credentials: true,
    exposeHeaders: ['x-mock-status'],
  },
})
```

## Bind to a random port in tests

```ts
const server = createServer(config)
const { port, close } = await server.listen({ port: 0 })

// ... run tests against http://127.0.0.1:${port} ...

await close()
```

`port: 0` asks the OS for a free port; the actual port comes back in
the handle.

## Inject a 503 on every route via the admin REST API

Enable `admin` (see [admin.md](./admin.md)), then POST a global
sticky override. Every subsequent request returns 503 until cleared.

```sh
curl -sS -X POST http://127.0.0.1:8000/databehave/overrides \
  -H 'content-type: application/json' \
  -d '{"matcher":{"kind":"global"},"mode":{"kind":"http-status","status":503}}'

curl -sS -X DELETE http://127.0.0.1:8000/databehave/overrides   # clear
```

## Replay a captured response as a custom-body override

Paste a real response payload as base64 JSON into a sticky `custom-body`
override; the mock returns it verbatim, with the status of your choice.

```sh
BODY_B64=$(printf '{"result":[{"id":1,"name":"replayed"}]}' | base64)
curl -sS -X POST http://127.0.0.1:8000/databehave/overrides \
  -H 'content-type: application/json' \
  -d "{\"matcher\":{\"kind\":\"exact\",\"method\":\"GET\",\"path\":\"/api/v1/products/list\"},
       \"mode\":{\"kind\":\"custom-body\",\"status\":200,\"body\":$(echo "$BODY_B64" | base64 -d)}}"
```

## Simulate slow networks with a sticky delay

A `delay` override wraps another mode (or passthrough). 3 seconds is
enough to exercise loading indicators without a test timing out.

```sh
curl -sS -X POST http://127.0.0.1:8000/databehave/overrides \
  -H 'content-type: application/json' \
  -d '{"matcher":{"kind":"global"},"mode":{"kind":"delay","ms":3000}}'
```

## Save and load named scenarios

Snapshot the current sticky overrides under a name, then re-apply later
in one step.

```sh
curl -sS -X POST http://127.0.0.1:8000/databehave/scenarios \
  -H 'content-type: application/json' -d '{"name":"all-503"}'

curl -sS -X POST http://127.0.0.1:8000/databehave/scenarios/all-503/load
# → {"loaded":1}
```

Scenarios live on disk under `admin.scenariosDir` (default
`${cwd}/mock-scenarios`). See [admin.md](./admin.md#scenarios).

## Enable per-request access logs

Set `"log": true` (shorthand for `{ "access": true }`) to emit one
stdout line per request, with override-tag suffixes such as
`[override:http-status]`. Full field reference, JSON format, and
admin-traffic toggle live in [config/log.md](./config/log.md).
