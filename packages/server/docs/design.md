# @databehave/server — Design Notes

The smallest possible explanation of *why* @databehave/server is shaped the way it is.

## 1. The thesis

A mock server should be **declarative configuration**, not a small
framework. You declare *which routes exist, what they return, and
when they should fail* — the runtime stays out of the way.

`@databehave/server` turns one `databehave.jsonc` (or one `Config` object)
into a running HTTP server. There is no app builder, no decorator
soup, no middleware DSL — only:

- a route table (`endpoints`),
- three optional lifecycle hooks (`onRequest`, `onResponse`,
  `onError`),
- declarative `mockMode` for status-injection,
- a CORS section,
- an optional `admin` panel + REST API + `x-mock-*` request
  headers for sticky / per-request error injection,
- an optional one-line-per-request access `log`,
- an OpenAPI fallback for gaps.

The HTTP runtime is a thin `node:http` ↔ Web Fetch adapter living in
`src/server.ts`. It is an implementation detail — handlers never
import it.

## 2. Non-goals (and why)

| Non-goal | Reason |
| --- | --- |
| General-purpose middleware framework | @databehave/server is for mocking. Use Fastify / Hono directly if you need a real app. |
| Persistence layer | Bodies come from handlers or OAS schemas; @databehave/server is stateless across requests. |
| Auth implementation | The `onRequest` hook is enough; baking in JWT/OAuth would couple us to libraries. |
| Bundler | `tsc` to ESM is enough. No esbuild, no rollup. |
| Strict OAS validation | The walker is permissive; gaps are reported via callbacks, not fatal. |
| Public-internet deployment | @databehave/server assumes a trusted network (dev / CI / staging). |
| Public-internet admin panel | `admin` is loopback-only by default and must not be exposed to untrusted networks. See [admin.md → Security notes](./admin.md#security-notes). |

## 3. Architecture

```bash
┌───────────────┐  load   ┌───────────────┐  build  ┌─────────────────┐
│ JSONC config  │ ──────▶ │  Config │ ──────▶ │  createServer  │
└───────────────┘         └───────────────┘         └─────────────────┘
                                  ▲                          │
                                  │                          ▼
                          ┌───────┴───────┐          ┌──────────────┐
                          │  OAS walker   │          │  dispatcher  │ ◀──┐
                          └───────────────┘          └─────┬───────┘    │
                                                            │           │
                                              fetch(Request)│listen()   │
                                                            ▼           │
                                                  ┌──────────────────┐ │
                                                  │   web Response   │ │
                                                  └──────────────────┘ │
                                                                      │
                                                                      │
   admin (opt-in) — UI / REST → overrides-store → inject hook ────┘
```

- **JSONC loader** (`src/json-config.ts`) reads the file, strips
  comments/trailing commas, interpolates `${VAR}`, dynamic-imports
  every `handler`, and produces a fully-assembled `Config`.
- **OAS walker** (`src/openapi/`) consumes the OpenAPI document and
  builds handlers for paths absent from `endpoints`. Hand-written
  routes always win.
- **Dispatcher** (`src/server.ts`) matches the incoming `Request` to a
  static or dynamic route key, runs the lifecycle hooks, calls the
  handler, and converts the `MockResponse` POJO into a web
  `Response`.

This separation is what lets the HTTP runtime stay swappable: only
`server.ts` and the small `request.ts` / `response.ts` adapters know
about the underlying `node:http` layer.

## 4. Dispatch pipeline

For every incoming request:

0. **Admin route short-circuit** — when `admin.enabled` and the
   request path starts with `admin.path`, the request is served
   directly by the admin REST / UI handlers. The dispatcher does not
   run `mockMode`, sticky overrides, or any real handler for these
   paths.
1. **Hooks.onRequest** — short-circuits if it returns a
   `MockResponse` (used by `mockMode` to force a status, by
   the admin inject hook to apply a sticky / header override, and by
   callers for auth).
2. **Route match** — exact-path lookup first (static), then a linear
   scan of dynamic patterns (`/users/:id`). First match wins.
3. **Handler** — receives `MockRequest`, returns `MockResponse`.
   May be sync or async.
4. **Hooks.onResponse** — may replace the response (used by `mockMode`
   to inject the `x-mock-status` header).
5. **Hooks.onError** — invoked on any thrown handler error. Returns
   the final response (defaulting to a generic 500).
6. **Response adapter** — turns the POJO into a web `Response`.

CORS, when configured, runs before step 1 for `OPTIONS` preflight and
attaches headers in step 6 for everything else.

### `HEAD` auto-derivation (RFC 7231 §4.3.2)

A `HEAD /path` request matches the corresponding `GET /path` route
automatically — the dispatcher runs the GET handler, then strips the
body before the response adapter serialises. Routes registered as
`HEAD …` explicitly still win over the auto-derive. There is no
configuration knob; this is the spec-mandated behaviour.

### Default `404` and `500` bodies

When no route matches, the dispatcher returns:

```jsonc
HTTP/1.1 404 Not Found
content-type: application/json

{ "error": "not_found", "method": "GET", "path": "/missing" }
```

When a handler throws and `hooks.onError` is absent (or itself
throws), the dispatcher falls through to:

```jsonc
HTTP/1.1 500 Internal Server Error
content-type: application/json

{ "error": "internal_error", "message": "<Error.message>" }
```

The `message` field is taken from the original `Error.message` —
not the stack — so secrets stashed in stack traces don't leak into
the wire response. Handlers that need a different shape should set
`hooks.onError` explicitly.

### `hooks.onServerError`

A separate hook for *infrastructure* errors that bubble out of the
HTTP runtime itself (socket errors, malformed framing, body-parse
failures). Distinct from `hooks.onError`, which only fires for
handler-level throws. `onServerError` receives `(err, req?)`,
returns nothing, and lets the runtime emit its default 500 — it
exists for observability (Sentry, structured logs), not response
shaping.

## 5. Route key model

```text
'METHOD /absolute/path'
'METHOD /users/:id'
```

- Method is upper-case (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`).
- Path must start with `/`.
- Segments prefixed with `:` are dynamic parameters captured into
  `MockRequest.params` (e.g. route `'GET /users/:id'` matched
  against `/users/42` yields `{ id: '42' }`).
- Duplicate route keys raise at boot — including duplicates between
  hand-written `endpoints` and the OAS walker (in that case the
  walker silently skips and the hand-written route wins).

In the JSONC config the `basePath` is prepended to any endpoint key
that does not start with `/`. So with `"basePath": "/api/v1"`:

```jsonc
"endpoints": {
  "GET products/list": "./src/routes/list.js",  // /api/v1/products/list
  "GET /health":             "./src/routes/health.js"  // /health (absolute)
}
```

## 6. MockResponse model

Handlers return a discriminated POJO. Exactly one body variant must
be set:

```ts
{ json: anyJsonValue }      // → application/json
{ text: string }            // → text/plain
{ html: string }            // → text/html
{ raw:  BodyInit }          // → caller-controlled
{ empty: true }             // → 204 / no body
```

Plus optional `status` (defaults to 200) and `headers` (merged with
the runtime defaults).

This is intentional. By forbidding `new Response(...)` in user code we
keep the runtime swappable and make tests trivially comparable.

`Vary` is the one response header that merges **additively** between a
handler-set value and the runtime-set `Origin` (when CORS is on);
every other header follows handler-wins. See
[config/cors.md#vary-origin](./config/cors.md#vary-origin).

## 7. Mock-mode middleware

The `mockMode` section turns @databehave/server into a programmable
error-injection gateway. Resolution priority, body resolution, and
the `x-mock-status` header tag are documented canonically in
[config/mock-mode.md](./config/mock-mode.md#resolution-priority-canonical).

The header `x-mock-status` is always tagged on the final response.
Paths in `healthPaths` bypass everything.

## 8. OpenAPI walker

Two concerns, two callbacks:

- **`onOpenApiWalkError(method, path, err)`** — the walker hit a
  genuinely unknown OAS construct. The route falls back to a stub
  body (`{}` for GET, `{ success: true, message: null }` for
  mutations) and the error is reported so the OAS author can fix it.
- **`onOpenApiEmptySchema(method, path, status)`** — the OAS declares
  `schema: {}` (i.e. "any JSON value" per JSON Schema). This is
  *valid* but uninformative; @databehave/server serves a stub and surfaces the
  gap so the spec gets filled in.

Body seeds for OAS-served routes are derived from
`endpoint + sorted query string + path params`, so the same URL
always returns the same body. See [openapi.md](openapi.md).

## 9. Determinism

OAS-driven bodies are deterministic by construction: the in-server,
zero-dep generator (`generateFromOasSchema`, `src/openapi/generate.ts`)
walks the OAS node and emits a placeholder JSON value purely from the
schema shape. The seed currently derived from
`endpoint|sorted(query)|params` is reserved for the future seeded-mode
item; the generator never reads the wall clock or `Math.random()`.
Hand-written handlers are free to be non-deterministic, but the
recommended pattern — when the optional `@databehave/schema`
companion is installed for richer fixtures — is to seed it the same
way.

## 10. Error model

- **Boot errors** — config validation failures, duplicate route keys,
  unsupported method names. Thrown synchronously from
  `loadConfig` / `createServer`.
- **Walker errors** — recoverable; surfaced via
  `onOpenApiWalkError` and replaced with a stub.
- **Handler errors** — caught by the dispatcher and routed to
  `hooks.onError`. If absent, a generic 500 is returned.

Nothing else throws across the boundary.

## 11. Admin mode

Opt-in panel + REST API + per-request `x-mock-*` headers. Default off;
flipping `admin.enabled: true` is the only opt-in.

Design principles:

- **Default off.** Absent or `enabled: false` keeps the kit byte-for-byte
  compatible with pre-`admin` versions — no admin routes, no header
  parsing, no overrides store wired in.
- **Loopback-only by default.** `bind: 'loopback-only'` refuses to
  enable when the server host is not loopback. Opt out with
  `bind: 'any'` (CLI exits 1 if the policy is violated). A one-line
  stdout banner on boot (`console.info`, "admin panel ready at …")
  surfaces the mount URL so misconfiguration is visible.
- **In-process overrides store.** Sticky overrides live in memory; they
  do not survive a restart unless saved as a scenario. The store is the
  single source of truth and is consumed by an inject hook installed at
  the front of the dispatch pipeline.
- **File-backed scenarios.** Named snapshots persist to
  `admin.scenariosDir` (default `${cwd}/mock-scenarios`). Names are
  restricted to `[A-Za-z0-9_-]{1,64}`; writes are atomic (tmp + rename).
- **Header > sticky.** `x-mock-*` request headers always beat sticky
  overrides and are discarded after the request — useful for one-off
  curl checks without polluting the store.
- **Resolution priority.** See [admin/overrides.md#sticky-override-resolution](./admin/overrides.md#sticky-override-resolution) for the canonical priority chain.
- **UI as native Web Components.** Single static bundle in `dist/admin/`
  (`ui.html`, `ui.js`, `ui.css`) — zero runtime UI framework, no CDN
  dependency. The REST API is the contract; the UI is just one client.

Full surface: [admin.md](./admin.md).

## 12. Access logs

Opt-in. The top-level `log` config builds a one-line-per-request logger
that writes to **stdout**. Off by default — no logger is constructed
and the request hot path is untouched.

The admin enable banner also writes to stdout (`console.info`); stderr
carries only runtime warnings and errors.

- Two formats: `pretty` (ANSI-coloured one-liner) and `json`
  (newline-terminated object, suitable for log shippers).
- Admin-panel traffic is suppressed by default. Set `includeAdmin: true`
  to log it too — the hot-path check is a single `startsWith` against
  the resolved admin base path.
- Sticky / header-driven overrides are surfaced with a trailing
  `[override:<kind>]` (pretty) or an `"override":"<kind>"` field (json)
  so injected responses are visible at a glance.

Diagnostics (walker errors, `mockMode` warnings) continue to flow
through the existing logger-injection contract; see
[stability.md](./stability.md#logger-injection).

## 13. Programmatic API reference

This section is the canonical reference for every symbol re-exported
from `src/index.ts`. The set is locked by
`test/public-surface.test.ts`; adding or removing a row here is a
SemVer event (see [stability.md#public-surface](./stability.md#public-surface)).

### `run(opts) → Promise<RunHandle>`

Boot a single server from a JSONC config path. Used by both the
`@databehave/server` binary and direct library callers — same code
path, same log lines, same error model.

```ts
import { run, type RunHandle, type RunOptions } from '@databehave/server'

const handle: RunHandle = await run({
  config: './databehave.jsonc',  // resolved relative to process.cwd()
  open:   false,                 // optional; ORed with admin.openBrowserOnStart
})
console.log(handle.url)          // "http://127.0.0.1:8000"
await handle.close()             // idempotent — second call is a no-op
```

`RunOptions` fields:

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `config` | `string` | required | Resolved relative to `process.cwd()` if not absolute. |
| `open`   | `boolean` | `false` | Open admin URL after `listening`. ORed with `admin.openBrowserOnStart`. No-op + log line when admin is absent or `enabled !== true`. |

`RunHandle` shape:

| Field | Type | Notes |
| --- | --- | --- |
| `url`     | `string` | Bound HTTP URL (e.g. `"http://127.0.0.1:8000"`). |
| `close()` | `() => Promise<void>` | Idempotent. Resolves once the listening socket is freed. |

The promise resolves *after* the underlying server emits `listening`
and the standard `[@databehave/server] listening on …` line is
written.

Source: `src/run.ts:1-115`.

### `createServer(config) → Server`

Lower-level entry point. Accepts an already-resolved
`Config` (typically built by `defineConfig` in TS
or returned by `loadConfig`) and returns a server
with both a `fetch(Request) → Promise<Response>` method (in-process,
no socket — used by tests, see
[recipes.md#in-process-testing-with-fetch](./recipes.md#in-process-testing-with-fetch))
and a `listen(opts)` method that binds a real `node:http` server.

```ts
import { createServer, defineConfig } from '@databehave/server'

const config = defineConfig({
  endpoints: { 'GET /health': () => ({ json: { ok: true } }) },
})
const server = createServer(config)

// In-process — no socket bound.
const res = await server.fetch(new Request('http://localhost/health'))

// Or bind a real server.
const handle = await server.listen({ host: '127.0.0.1', port: 0 })
await handle.close()
```

`Server` is the return type — its full shape lives in
`src/types.ts` and is re-exported as a type. See [§4 dispatch
pipeline](#4-dispatch-pipeline) for the request flow inside `fetch`.

Source: `src/server.ts:253` (`createServer`),
`src/types.ts:Server`.

### `seedFor(input) → string`

Pure helper for building a deterministic seed string. Same input →
same output → companion data-generation engines (e.g.
`@databehave/schema`) yield byte-identical JSON. Re-exported so
consumers don't have to reimplement the format.

Format: `<endpoint>|<sortedKey>=<val>|...|date=<from>|day=<dayOffset>`.

```ts
import { seedFor, type SeedInput } from '@databehave/server'

const seed = seedFor({
  endpoint:  '/api/v1/products/list',
  extra:     { region: 'east', page: 2 },     // keys sorted recursively
  from:      '2024-01-01',                    // optional → "date=…"
  dayOffset: 0,                               // optional → "day=…"
})
// → '/api/v1/products/list|page=2|region=east|date=2024-01-01|day=0'
```

`SeedInput` rules:

| Field | Type | Notes |
| --- | --- | --- |
| `endpoint` | `string` | Required. Free-form; the URL path is the convention. |
| `extra` | `Record<string, unknown>` | Optional. Object keys are sorted recursively; arrays preserve order; objects/arrays are JSON-stringified after key-sort; cycles fall back to `String(v)`. |
| `from` | `string` | Optional. Emitted as `date=<from>`. |
| `dayOffset` | `number` | Optional. Emitted as `day=<n>`. |

Source: `src/openapi/seed.ts:1-65`.

### `loadConfig(path, options?) → Promise<LoadedConfig>`

Read a JSONC config from disk, validate it, dynamic-import every
handler module, and return both a resolved `Config` and
the `listen()` options the CLI uses. Throws synchronously after
parsing on any validation failure — see
[errors.md#1-jsonc-config-errors-srcjson-configts](./errors.md#1-jsonc-config-errors-srcjson-configts).

```ts
import {
  loadConfig,
  type LoadConfigOptions,
  type LoadedConfig,
  type JsonConfig,
  type EndpointSpec,
  type EndpointResponse,
} from '@databehave/server'

const { config, server } = await loadConfig(
  './databehave.jsonc',
  {
    handlers: {                         // pre-resolved handlers (test bypass)
      './src/routes/health.js': () => ({ json: { ok: true } }),
    },
    logger: { warn: console.warn },     // sink for non-fatal warnings
  },
)
```

`LoadConfigOptions` fields:

| Field | Type | Purpose |
| --- | --- | --- |
| `handlers` | `Record<string, Handler>` | Bypass dynamic `import()` for the listed module specifiers. Keys are matched after stripping leading `./` and the extension (`.js` / `.mjs` / `.cjs` / `.ts` / `.tsx` / `.mts` / `.cts`). Routes not in the map fall back to dynamic import. Non-function values throw at boot. Used by vitest under plain Node 18. |
| `logger` | `{ warn(message: string): void }` | Sink for non-fatal walker / empty-schema warnings. Defaults to `console.warn`. |

`LoadedConfig` shape: `{ config: Config,
server: ListenOptions }`.

Companion types `EndpointSpec`, `EndpointResponse`, and
`JsonConfig` describe the JSONC shape — see
[config/endpoints.md](./config/endpoints.md) for the full field
matrix.

Source: `src/json-config.ts:597-906`.

### Mock-mode types

`MockModeConfig` (and its `MockModeLogger` sink) describe the
`mockMode` section of `JsonConfig` consumed by `loadConfig`.
`resolveStatus(method, path, config)` is exported for unit tests.

The wiring helpers (`buildMockModeHooks`, `BodyResolver`,
`MockModeHooks`) are internal — `@databehave/server` is monolithic
and wires them itself when you set `mockMode.enabled: true` in
JSONC. They are not part of the public surface; do not import them
from `'@databehave/server'`.

Resolution priority and body resolution are documented canonically in
[config/mock-mode.md#resolution-priority-canonical](./config/mock-mode.md#resolution-priority-canonical).

Source: `src/mock-mode.ts:84-200`.

### `defineConfig(config) → Config`

Identity helper for TS callers — returns the input untouched at
runtime, but gives editors a clean type-narrowing site. In
non-`production` `NODE_ENV` it also `Object.freeze`s the config
recursively so accidental mutation throws in dev / CI. See
[config/index.md#programmatic-config](./config/index.md#programmatic-config).

### Type re-exports — `Config` and friends

The full kit config surface is exposed as type-only re-exports.
Documented per-field across `config/*.md`; this is the API-surface
roll-up:

| Type | Purpose | Doc |
| --- | --- | --- |
| `Config` | Top-level config object passed to `createServer`. | [config/index.md#programmatic-config](./config/index.md#programmatic-config) |
| `CorsConfig` | `cors` section. | [config/cors.md](./config/cors.md) |
| `Method` | Union of supported HTTP methods (`'GET' \| 'POST' \| ...`). | [§5 route key model](#5-route-key-model) |
| `ObservedMethod` | `Method \| 'HEAD' \| 'OPTIONS'` — the methods the dispatcher observes (HEAD auto-derives, OPTIONS handles preflight). | [§4 dispatch pipeline](#4-dispatch-pipeline) |
| `RouteKey` | Branded string `'METHOD /path'`. | [§5 route key model](#5-route-key-model) |
| `MockRequest` | Handler input — `{ url, method, path, params, query, headers, body }`. | [§6 response model](#6-response-model) |
| `MockResponse` | Handler output — discriminated POJO. | [§6 response model](#6-response-model) |
| `MockResponseBody` | The body discriminator (one of `json` / `text` / `html` / `raw` / `empty`). | [§6 response model](#6-response-model) |
| `Handler` | `(req: MockRequest) => MockResponse \| Promise<MockResponse>`. | [config/endpoints.md](./config/endpoints.md) |
| `ListenOptions` | Argument to `server.listen()` — `{ host?, port?, signal? }`. | [recipes.md#bind-to-a-random-port-in-tests](./recipes.md#bind-to-a-random-port-in-tests) |
| `ListenHandle` | Return of `server.listen()` — `{ host, port, close() }`. | [recipes.md#bind-to-a-random-port-in-tests](./recipes.md#bind-to-a-random-port-in-tests) |
| `Server` | Return of `createServer` — `{ fetch, listen }`. | This section. |

Source: `src/types.ts:1-310`.

### Admin types (public surface)

`AdminModeConfig`, `ErrorMode`, `StickyOverride`, `OverrideMatcher`,
`AdminModeCors` are documented in [admin/](./admin/index.md) and
[admin/error-mode.md](./admin/error-mode.md). They appear on
`Config.admin` and on the JSONC `admin` section.

The wiring helpers (`createOverridesStore`, `createInjectHook`,
`parseMockHeaders`) are internal — `@databehave/server` wires them
itself when `admin.enabled: true`. They are not part of the public
surface; do not import them from `'@databehave/server'`.
