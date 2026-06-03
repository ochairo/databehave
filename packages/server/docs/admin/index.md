# Admin mode

Opt-in error-injection panel + REST API + per-request `x-mock-*` headers,
mounted under a configurable base path (default `/databehave`). All routes,
headers, and behaviours below are served **only** when
`admin.enabled: true`. With the flag off, the kit behaves exactly as
the pre-`admin` versions did — no admin routes, no header parsing, no
overrides store.

For the `admin` config schema (`enabled`, `path`, `bind`, `cors`,
`allowDestroy`, `scenariosDir`) see
[../config/admin.md](../config/admin.md).

## Sub-pages

- [rest-api.md](./rest-api.md) — every `__databehave/*` endpoint.
- [headers.md](./headers.md) — every `x-mock-*` request header.
- [overrides.md](./overrides.md) — sticky overrides, matchers, resolution priority.
- [scenarios.md](./scenarios.md) — scenario file format and lifecycle.
- [error-mode.md](./error-mode.md) — `ErrorMode` reference.

## Quick start

```jsonc
// databehave.jsonc
{
  "openapi":   "./openapi.json",
  "basePath":  "/api/v1",
  "endpoints": { /* ... */ },
  "admin": { "enabled": true }
}
```

```sh
npx @databehave/server databehave.jsonc
# stdout: [@databehave/server] admin panel ready at http://127.0.0.1:8000/databehave (dev mock — disable in production)
```

Point a browser at `http://127.0.0.1:8000/databehave`.

Programmatic equivalent:

```ts
import { createServer } from '@databehave/server'

const server = createServer({
  routes: { 'GET /api/v1/ping': () => ({ json: { ok: true } }) },
  admin: { enabled: true },
})
await server.listen({ port: 8000, host: '127.0.0.1' })
```

## UI overview

The UI is shipped as `dist/admin/{ui.html, ui.js, ui.css}` and rendered
with native Web Components — zero runtime framework, no CDN dependency.
English-only.

- **Endpoint list** — populated from `GET {path}/openapi-routes`, grouped by
  OpenAPI tag, filterable. Each row opens an inject panel that pre-fills
  from any existing sticky override targeting the same route.
- **Global override modal** — top-bar button. Owns `kind: 'global'`
  overrides (the per-endpoint inject panel only offers `exact` and `path`
  scopes).
- **Active overrides side panel** — right side. Global rows are tagged
  `GLOBAL` and float above `path` / `exact` rows. A floating bottom-right
  pill shows the active count.
- **Try-it-out** — runs the live request through the dispatcher so the
  injected override actually applies. The response viewer renders the
  body as a collapsible **schema tree** for JSON responses (each
  property is a fold-able row) and falls back to a raw text panel for
  non-JSON bodies.
- **Scenarios menu** — list, save (snapshot of the current overrides),
  load, and delete named scenarios from disk.
- **Toasts** — successful saves, deletes, and override-create actions
  fire a top-right toast (`success` / `error` / `info` variants);
  failures show the REST [error envelope](./rest-api.md#error-envelope)
  detail verbatim.
- **Keyboard** — `/` and `Cmd/Ctrl+K` focus the route filter, `Esc`
  closes modals, `?` shows the help overlay.

### Non-default `admin.path`

The UI is path-agnostic. When `admin.path` is set to anything
other than the default `/databehave`, the boot-time HTML injects a
`window.__DATABEHAVE_BASE__ = '<path>'` shim before `ui.js` runs.
The UI reads that constant for every REST call so the panel works
unchanged behind a reverse proxy or a custom mount point.

If you load the panel through a build of your own (rare), set
`window.__DATABEHAVE_BASE__` yourself before importing
`ui.js` — the script falls back to `/databehave` only when the
constant is absent.

## Security notes

`admin` is a developer tool — not a hardened endpoint. Do not expose
the admin panel to untrusted networks.

- **Startup notice.** Every enabled boot writes
  `admin panel ready at http://…/databehave (dev mock — disable in production)` to stdout. Misconfiguration is visible.
- **`bind: 'loopback-only'` (default).** The CLI exits 1 (and
  `server.listen()` rejects) when the configured host is not a loopback
  address. Set `bind: 'any'` to opt out — only in trusted environments.
- **`cors: 'auto'` (default).** Returns `Access-Control-Allow-Origin: *`
  on loopback (so a localhost bookmarklet works) and switches to
  `same-origin` (no CORS headers added) when `bind: 'any'`. Override with
  `'any'`, `'same-origin'`, or `{ origin }`.
- **`allowDestroy: true` (default).** Honours `x-mock-destroy` and the
  matching `destroy` ErrorMode. Set `false` to reject those requests with
  HTTP 503 instead.
