# `admin`

Opt-in admin panel + REST API for sticky error overrides and per-request
`x-mock-*` header injection. Default **off** — when absent or
`enabled: false` the kit serves nothing under the mount path and ignores
`x-mock-*` headers (zero behaviour change for existing consumers). When
enabled the kit writes a one-line stdout banner on boot (see
[admin/index.md#security-notes](../admin/index.md#security-notes) for the
canonical banner format) and mounts the UI + REST routes under `path`.

```jsonc
"admin": {
  "enabled":      true,
  "path":         "/databehave",
  "bind":         "loopback-only",
  "allowDestroy": true,
  "cors":         "auto",
  "scenariosDir": "./mock-scenarios"
}
```

| Field          | Default                          | Meaning |
| -------------- | -------------------------------- | --- |
| `enabled`      | `false`                          | Master switch. Absent or `false` = feature off. |
| `path`         | `'/databehave'`                  | Mount point for UI + REST. Must start with `/`. |
| `ui`           | `true`                           | Serve the admin HTML / `ui.js` / `ui.css` at `${path}`. Set `false` for a REST-only deployment (no static assets). |
| `headers`      | `true`                           | Honour `x-mock-*` request headers. Set `false` to keep the sticky-override REST API enabled while ignoring per-request header overrides. |
| `bind`         | `'loopback-only'`                | Refuse to enable when the server host is not loopback. Set `'any'` to opt out (CLI exits 1 if the policy is violated). |
| `allowDestroy` | `true`                           | Honour `x-mock-destroy` / `destroy` ErrorMode. `false` → reject with HTTP 503. |
| `cors`         | `'auto'`                         | `'auto'` \| `'any'` \| `'same-origin'` \| `{ origin }`. `'auto'` resolves to `*` on loopback, `'same-origin'` when `bind: 'any'`. |
| `scenariosDir` | `${cwd}/mock-scenarios`          | Directory used by the file-backed scenarios endpoints. |
| `openBrowserOnStart` | `false`                    | When `true`, spawn the platform browser opener on the admin URL after `listening`. Default off — the URL is logged but no browser is launched. ORed with the CLI's `--open` flag. |
| `openapiBody`  | undefined                        | **Programmatic only.** Override the OpenAPI document the admin route picker advertises at `GET ${path}/openapi-routes` and `GET ${path}/openapi.json`. Accepts the raw JSON text. When omitted, the kit reuses the same OAS bytes the dispatcher loaded from `openapi:`. Useful when the admin UI should expose a different surface than the dispatcher (e.g. an internal-only spec). |

> **Security.** `bind: 'loopback-only'` is the default. Setting
> `bind: 'any'` exposes the overrides REST API and the per-request
> `x-mock-*` headers to the network — only do this in trusted
> environments. See [../admin/index.md#security-notes](../admin/index.md#security-notes).

> **Route list.** The admin UI lists OAS routes and hand-written
> `endpoints` together. Routes registered only via programmatic
> `routes` are also included; OAS wins on duplicates.

Full REST surface, matcher / ErrorMode reference, `x-mock-*` header
table, sticky-override resolution priority, scenarios file format — see
[../admin/](../admin/index.md).

## Route collision detection

Admin routes are mounted under `${path}` (`/openapi-routes`,
`/overrides`, `/scenarios`, …). When a hand-written `endpoints` key
collides with one of those admin routes, the kit refuses to boot
rather than silently shadowing one with the other:

```text
@databehave/server: admin route GET /databehave/overrides collides with a user-declared route. Move admin.path to a free prefix or rename the user route.
```

Fix: change `admin.path` to a free prefix (`/_admin`, `/__mock`,
…) or rename the user route. The collision check fires on every
admin sub-route, including the static UI assets at `${path}/ui.js`
and `${path}/ui.css`.
