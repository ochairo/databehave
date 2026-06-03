# `endpoints`

The route table. Keys are `"METHOD <path>"`. Values pick one of three
forms:

## 1. String (handler module path)

```jsonc
"GET products/list": "./src/routes/products/get/list.js"
```

Shorthand for `{ "handler": "..." }`. The module must:

- be loadable via the runtime's native ESM `import()`,
- `export default` a `Handler` (a function returning a
  `MockResponse` POJO, sync or async).

CommonJS modules are not supported by the JSONC loader's resolver —
its dynamic-import path runs through `pathToFileURL()` and assumes
ESM. If the module's default export is missing or is not a function,
boot fails with:

```text
@databehave/server/config: ./src/routes/products/get/list.js (mapped to GET /api/v1/products/list) has no default-exported handler function
```

### Handler resolution

Config files reference handlers by their compiled `.js` path so they
stay valid for production `tsc`-built deployments. In dev / test
scenarios where only the TypeScript source exists on disk, the
resolver falls back to a sibling extension automatically — `.js`
becomes `.ts`, `.tsx`, `.mts`, or `.cts` (in that order) — so test
runners that register a TS loader (`vitest`, `tsx`, `ts-node`) pick
the right file without any config change.

Set `DATABEHAVE_PREFER_TS=1` to **prefer** `.ts` siblings over the
declared `.js` even when both exist on disk. Useful in dev when an
outdated `dist/` is still around and would otherwise win. The
variable accepts only the literal string `"1"`; any other value
(including `true`) is treated as off.

## 2. Handler object

```jsonc
"POST products/bulk-update": {
  "handler": "./src/routes/products/update/bulk-update.js",
  "status": 500
}
```

The optional `status` field is a shortcut that registers an entry in
`mockMode.pathOverrides` for this route. Use it to force an error
status without editing the handler.

## 3. Static response

```jsonc
"GET /health": {
  "response": {
    "status": 200,
    "json":   { "ok": true },
    "headers": { "cache-control": "no-store" }
  }
}
```

No handler module is loaded; the response is returned verbatim. Use
`"empty": true` instead of `"json"` for an empty body.

### `EndpointResponse` fields

| Field     | Required | Meaning |
| --------- | -------- | --- |
| `status`  | yes      | HTTP status integer. Boot fails with `endpoints["KEY"].response.status must be a number` if missing or non-numeric — there is no implicit `200`. |
| `json`    | no       | JSON body. Mutually exclusive with `empty`. May be any JSON value (`null`, `[]`, `{}` are all valid). When omitted on a non-`empty` response the body is `null`. |
| `empty`   | no       | When `true`, the response carries no body. Boot fails with `endpoints["KEY"].response.empty must be a boolean` if the value is non-boolean. |
| `headers` | no       | Plain `Record<string, string>` merged into the response. Non-string values raise `endpoints["KEY"].response.headers["H"] must be a string` at boot. Header keys are case-preserved as written. |

`handler` and `response` are mutually exclusive. Setting both raises:

```text
@databehave/server/config: endpoints["KEY"] cannot have both "handler" and "response"
```

An empty `{}` value is also rejected:

```text
@databehave/server/config: endpoints["KEY"] must have either "handler" or "response"
```

A `status` field next to `response` (instead of inside it) is rejected
with a hint pointing at the correct location:

```text
@databehave/server/config: endpoints["KEY"].status cannot be combined with "response" (put status inside response)
```

## Programmatic `handlers` override

`loadConfig(path, { handlers })` accepts an explicit
module-path → function map that short-circuits the dynamic `import()`
for matching keys. Use case: test environments (vitest under plain
Node 18) that cannot load `.ts` source files through native
`import()`. Construct the map via static imports or
`import.meta.glob('eager')`, then pass it in.

```ts
import { loadConfig } from '@databehave/server'
import healthHandler from './src/routes/health.ts'

await loadConfig('./databehave.jsonc', {
  handlers: {
    './src/routes/health.js': healthHandler,
  },
})
```

Keys are canonicalised before lookup: a leading `./` is stripped,
repeated `/` are collapsed, and the trailing
`.js` / `.mjs` / `.cjs` / `.ts` / `.tsx` / `.mts` / `.cts` is dropped
— so `./src/routes/health.js`, `src/routes/health`, and
`./src/routes/health.ts` all collapse to the same lookup key.
Handlers not present in the map fall back to dynamic import. Values
that are not functions raise at boot:

```text
@databehave/server/config: handlers override for "./src/routes/health.js" (mapped to GET /health) is not a function (got TYPE)
```

## Programmatic `logger` injection

`loadConfig(path, { logger })` redirects non-fatal
warnings (OAS walker errors, empty schemas, mock-mode header
diagnostics) to a custom sink. Defaults to `console.warn`. Inject a
no-op logger from tests to silence the output, or a structured logger
in production:

```ts
await loadConfig('./databehave.jsonc', {
  logger: { warn: (m) => myLogger.warn({ src: 'databehave', m }) },
})
```

The injected logger only catches warnings emitted while loading the
config and wiring the OpenAPI / mock-mode adapters — it does not
intercept access logs (those go through the [`log`](./log.md)
config) or per-request `console.warn` calls from user handlers.

## `basePath` collisions

When the JSONC config sets `basePath`, every relative endpoint key
(e.g. `"GET products/list"`) is rewritten to absolute
(`"GET /api/v1/products/list"`). If two distinct keys collide after
rewriting — typically because one was already absolute and the other
relative to the same final path — the loader fails fast at boot:

```text
@databehave/server/config: endpoints keys "GET /api/v1/products/list" and "GET products/list" both resolve to "GET /api/v1/products/list" after applying basePath
```

There is no last-write-wins fallback. Pick one form per route.
