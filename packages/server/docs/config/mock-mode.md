# `mockMode`

```jsonc
"mockMode": {
  "enabled":             true,
  "header":              "x-mock-status",
  "healthPaths":         ["/health", "/healthz", "/api/v1/health"],
  "defaultStatus":       200,
  "allowHeaderOverride": false,
  "pathOverrides": {
    "GET /api/v1/products/list": 500,
    "/api/v1/admin/users-delete": 401
  }
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Master switch. `false` / absent = feature off. |
| `header` | `'x-mock-status'` | Response header tagged with the resolved status. Also the request header consulted when `allowHeaderOverride: true`. |
| `healthPaths` | `[]` | Paths exempt from injection (typically health probes). |
| `defaultStatus` | undefined | Status applied when no override matches. Omit for passthrough. |
| `allowHeaderOverride` | `false` | When `true`, an incoming request may flip the mocked status by sending the same `header` (default `x-mock-status: 500`). Disabled by default so production-style mock servers don't expose status injection to arbitrary clients. |
| `pathOverrides` | `{}` | Per-route status overrides. Keys are `"METHOD /path"` or `"/path"` (path must start with `/`). Values are HTTP status codes. |
| `logger` | `console` | Programmatic-only sink for non-fatal mock-mode diagnostics (e.g. out-of-range header overrides). Pass the host application's logger to keep mock-server output in one place. Not settable from JSONC. |

## Resolution priority (canonical)

For each request, mock-mode picks a status in this order — first hit
wins. When `admin.enabled` is also set, the admin inject hook
runs **before** mock-mode and can short-circuit any of the steps
below; see [../admin/overrides.md#sticky-override-resolution](../admin/overrides.md#sticky-override-resolution)
for the unified pipeline.

1. Request `header` value (only when `allowHeaderOverride: true`).
2. `pathOverrides["<METHOD> <path>"]` (method-scoped exact match).
3. `pathOverrides["<path>"]` (any-method exact match).
4. `defaultStatus`.
5. Passthrough — the real handler runs.

`healthPaths` short-circuits the entire chain: matching paths are
served by their handler regardless of any override.

## `pathOverrides` key validation

Keys are validated at config load. Malformed keys raise at boot
(via `AggregateError` so every gap surfaces at once) — there is no
silent "this key never matches" failure mode.

- Keys must match `(?:METHOD\s+)?/path`. The optional method prefix
  is one of `GET POST PUT DELETE PATCH HEAD OPTIONS`. The path must
  start with `/` and contain no whitespace.
- Method names are normalised to upper-case: `"get /api/x"`,
  `"GET /api/x"`, and `"Get /api/x"` all canonicalise to
  `"GET /api/x"` so a lower-case key still matches.
- Values must be finite numbers (HTTP status codes).

## Body resolution

When a non-passthrough status `N` fires:

1. `status === 204` → empty body.
2. The body resolver returns the OAS `responses[N]` schema mock when
   the route is OAS-walker-backed and a response schema exists for
   that status (see [../openapi/fallback.md#per-status-body-generators](../openapi/fallback.md#per-status-body-generators)).
3. Fallback envelope `{ error: true, status: N }`.

The configured `header` (default `x-mock-status`) is always tagged on
the response with the resolved status code so a client can confirm
which override fired.

## `allowHeaderOverride` validation

When the request header is set but the value is not a finite integer
in `[200, 600)`, the value is **ignored** and a single `warn` line
is emitted via `logger` (default `console`) so the typo is visible
without breaking legitimate clients that ship the header for other
reasons:

```text
@databehave/server/mock-mode: ignored x-mock-status="abc" (must be an integer in [200, 600))
```

A per-endpoint shortcut also exists — see [endpoints.md](./endpoints.md).
