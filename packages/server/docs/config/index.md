# Configuration reference

`@databehave/server` is configured by one file (`databehave.jsonc`) or one
`Config` object passed to `createServer`. This page covers
the file form; the programmatic form mirrors it field-for-field.

## File format

- Extension can be `.json` or `.jsonc`. Either way, JSONC features are
  accepted:
  - `// line` comments
  - `/* block */` comments
  - trailing commas
- Every string value supports `${VAR}` and `${VAR:default}` env
  interpolation. Missing env without default → empty string.
- Variable names accept ASCII letters, digits, and `_`, with the
  leading character restricted to a letter or `_`. Lowercase and
  mixed-case names are allowed (`${path}`, `${myVar}`); the loader
  does not require ALL_CAPS shell convention.
- Every relative path is resolved against the **directory of the
  config file**.

## Environment variables (process-level)

Two env vars influence boot behaviour beyond `${VAR}` interpolation:

| Variable | Effect |
| --- | --- |
| `NODE_ENV` | When **not** equal to `'production'`, both `defineConfig` and the JSONC loader deep-freeze the resolved config so accidental mutation throws in tests. Production skips the freeze so callers may legitimately patch the object after construction. |
| `DATABEHAVE_PREFER_TS=1` | Prefer a `.ts` / `.tsx` / `.mts` / `.cts` sibling over the declared `.js` for handler resolution, even when the `.js` exists on disk. Useful in dev when an outdated `dist/` is still around. Default off. |

## Top-level shape

```jsonc
{
  "openapi":   "./openapi.json",        // optional, JSON only
  "server":    { "host": "...", "port": 8000 },
  "basePath":  "/api/v1",               // optional
  "cors":      { /* ... */ },           // optional
  "mockMode":  { /* ... */ },           // optional
  "admin": { /* ... */ },           // optional, default off
  "log":       false,                   // optional, default off
  "endpoints": { /* ... */ }            // route → handler / response
}
```

## Field reference

- [openapi.md](./openapi.md) — `openapi:` (path to the OAS document).
- [server.md](./server.md) — `server:` host / port and `basePath:`.
- [endpoints.md](./endpoints.md) — `endpoints:` route table and handler shorthand forms.
- [cors.md](./cors.md) — `cors:` block.
- [mock-mode.md](./mock-mode.md) — `mockMode:` block.
- [admin.md](./admin.md) — `admin:` block (config knobs only — admin behaviour is in [../admin/](../admin/index.md)).
- [log.md](./log.md) — `log:` block.
- [schema.md](./schema.md) — `schema:` (auto-schema config knobs — auto-mode behaviour is in [../openapi/auto-schema.md](../openapi/auto-schema.md)).
- [validation.md](./validation.md) — `validation:` block.

For the CLI that consumes the `server` section, see [../cli.md](../cli.md).

## Programmatic `Config`

```ts
import { createServer, defineConfig } from '@databehave/server'

const config = defineConfig({
  routes: {
    'GET /api/v1/ping': () => ({ json: { ok: true } }),
  },
  hooks: {
    onRequest:  (req) => { /* short-circuit by returning a MockResponse */ },
    onResponse: (req, res) => res,
    onError:    (req, err) => ({ status: 500, json: { error: true } }),
  },
  cors: { origin: (o) => o || '*', credentials: true },
  openapi: undefined,                   // pass JSON OAS text here to enable
  onOpenApiWalkError:   (m, p, err) => console.warn(`walk failed: ${m} ${p}`, err),
  onOpenApiEmptySchema: (m, p, s) => console.warn(`empty schema: ${m} ${p} ${s}`),
})

const server = createServer(config)
```

`defineConfig` is an identity function — present for IDE support, it
gives you the strict `Config` type inline. When `NODE_ENV !==
'production'` it also deep-freezes the returned config so accidental
mutation (e.g. `config.routes['GET /x'] = …`, pushing into
`cors.allowMethods`) throws in tests instead of silently corrupting the
running server. Handler functions are intentionally left mutable — freeze
stops at function boundaries. Production skips the freeze so callers may
legitimately patch the object for env-specific wiring.

## Programmatic API surface

Everything reachable from the package entry point. Every field above
maps to a typed member of `Config` (see the source
declaration in `src/types.ts`).

| Export | What it is |
| --- | --- |
| `createServer(config)` | Build a `Server` from an in-memory config. Returns `{ fetch, listen }`. The HTTP runtime is `node:http` ↔ Web Fetch under the hood. |
| `defineConfig(config)` | Identity helper for IDE intellisense + dev-mode deep-freeze (see above). |
| `loadConfig(path, opts?)` | Read a JSONC file from disk and resolve every handler module. `opts.handlers` short-circuits dynamic `import()` (test-friendly bypass — see [endpoints.md](./endpoints.md#programmatic-handlers-override)); `opts.logger` redirects walker / mock-mode warnings to your sink (defaults to `console.warn`). |
| `run({ config, open? })` / `RunHandle` | One-call boot: load JSONC, build the server, bind the listen port, optionally open the admin URL. `RunHandle.close()` is idempotent. Used by both the CLI and direct library consumers so log lines and error model match exactly. |
| `seedFor({ endpoint, from?, dayOffset?, extra? })` | Pure helper for building deterministic databehave seed strings (`<endpoint>|<key>=<val>|date=<YYYY-MM-DD>|day=<n>`). Re-exported so consumers can derive their own seeds without reimplementing the format. |
| `resolveStatus` / `MockModeConfig` / `MockModeLogger` | `resolveStatus(method, path, config)` is exported for unit tests. `MockModeConfig` (and its `logger` sink `MockModeLogger`) is the type of `JsonConfig.mockMode`. The wiring (`buildMockModeHooks`, `BodyResolver`, `MockModeHooks`) is internal — set `mockMode.enabled: true` in JSONC. |
| `Config` and sibling types (`Method`, `MockRequest`, `MockResponse`, `Cors`, `Handler`, `ListenOptions`, `Server`, `AdminModeConfig`, `ErrorMode`, …) | Strict type declarations exported from `src/types.ts` / `src/admin/admin-types.ts`. |
