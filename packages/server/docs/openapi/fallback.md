# OpenAPI fallback

Paths declared in the OpenAPI document but absent from `endpoints` are
auto-served by the walker. **Hand-written routes always win** — the
walker silently skips any key already declared in `endpoints`. There
is no precedence flag; the OAS doc is the source of truth for *gaps*,
not for overrides. This rule is canonical here; other pages link back.

This is intentional. The OAS document is your spec; @databehave/server treats it
as the source of truth for *gaps*, not as an override.

## Input format

@databehave/server accepts **JSON** OpenAPI documents only — convert
YAML first via `yq -o=json openapi.yaml > openapi.json` and pass the
JSON path or string to the loader. YAML inputs are rejected at boot;
see [config/openapi.md](../config/openapi.md) for the canonical
error wording.

A leading UTF-8 byte-order mark (`U+FEFF`) is stripped before parsing,
so files exported from Windows tooling load without manual cleanup.
After BOM stripping, the input must parse as plain JSON or
`JSON.parse` raises (caught and re-thrown with the file path
prepended).

## Pipeline

```bash
openapi.json ─▶ parser ─▶ paths.<p>.<m> ─▶ walker ─▶ generateFromOasSchema ─▶ response
                                       │
                                       ├─▶ onOpenApiWalkError   (recoverable)
                                       └─▶ onOpenApiEmptySchema (advisory)
```

The walker visits every `paths.*.<method>.responses['200'].content
['application/json'].schema` and feeds the OAS node to the in-server,
zero-dep generator (`src/openapi/generate.ts`), which produces a
deterministic placeholder JSON value. For non-200 responses (used by
`mockMode`), the same generator feeds the per-status body builders.
For richer mock data (distributions, datasets, FK-aware generation),
install `@databehave/schema` separately and pre-generate fixtures —
the server itself pulls no DSL dependency at runtime.

### What the walker visits

- `paths['/']` (root) is **skipped**. Use an explicit `endpoints`
  entry if you need to serve `/`.
- HTTP methods walked are exactly `get`, `post`, `put`, `delete`,
  `patch`. `head` and `options` are handled by the dispatcher
  (HEAD auto-derives from GET; OPTIONS is owned by CORS / admin).
- Vendor extensions (`x-*` keys) on path items are ignored.
- The OAS-only generator (`src/openapi/generate.ts`) is **not**
  depth-capped; cyclic `$ref`s are detected via a visited-pointer
  set and collapse to `{}` rather than infinite-loop. The
  auto-schema translator and the request validator both hard-cap
  recursion at **64** levels of nested `properties` / `items` /
  `allOf` / `oneOf` / `anyOf` and **fail loud** past that — see
  [`keywords.md` → Auto-schema translator](./keywords.md#auto-schema-translator-schema-set)
  and [`config/validation.md#security-guarantees`](../config/validation.md#security-guarantees).
  Hit either in practice → flatten the schema or declare the
  route in `endpoints` directly.

### Status code picked

For mock-mode passthrough (no override) the walker picks the
response body from `responses['200']`. For mock-mode injected
statuses, the body comes from the smallest `2xx` declared in the
spec when an exact match is missing, falling back to the OAS
`default` response, falling back to the envelope
`{ error: true, status: N }`. `204` always renders as an empty
body regardless of what the spec declares.

### Per-status body generators

`buildOpenApiResponseGenerators(doc)` exposes the per-status body
table the dispatcher uses internally — keyed by `"METHOD path"`,
each entry maps a status code to a memoised body generator. The
function is exported so consumers wiring mock-mode into a custom
dispatch can reuse the same body shapes the kit ships with. See
[../config/mock-mode.md#body-resolution](../config/mock-mode.md#body-resolution)
for how the dispatcher consumes the table.

## Deterministic seeds

For a route `/users/:id` matched against `/users/42?expand=profile`:

```text
seed = sha256(
  '/users/:id'                        // @databehave/server pattern, not the live URL
    + '|param:id=42'                  // path params first (sorted)
    + '|expand=profile'               // query params (sorted)
)
```

Same URL → same JSON body, byte-for-byte, on every machine. This is
what makes snapshot tests stable across CI runs.

Per-status bodies use `endpoint|status` as the seed, so the 500 body
for `/users/:id` is stable but different from the 404 body.

## Empty / permissive schemas (`schema: {}`)

```jsonc
{
  "/api/v1/anything": {
    "get": {
      "responses": {
        "200": {
          "content": {
            "application/json": {
              "schema": {}   // ← "any JSON value" per JSON Schema
            }
          }
        }
      }
    }
  }
}
```

Per JSON Schema spec this matches any value, so @databehave/server:

1. Does **not** raise this via `onOpenApiWalkError` — it is a valid
   OAS construct.
2. Serves a small stub body (`{}` for GET, `{ success: true, message:
   null }` for mutations).
3. Surfaces the gap via the dedicated `onOpenApiEmptySchema` callback
   so you can fix the spec.

The default JSONC loader wires this to a friendly warning:

```text
[@databehave/server] OAS response schema is empty for GET /api/v1/anything (status 200)
        — serving stub. Consider filling the schema in your OpenAPI document.
```

To handle it yourself programmatically:

```ts
createServer({
  openapi: doc,
  onOpenApiEmptySchema: (method, path, status) => {
    metrics.increment('@databehave/server.empty_schema', { method, path, status })
  },
})
```

## Walker failures

When the walker hits an OAS construct it genuinely cannot translate
(unsupported keyword, unresolvable `$ref`, etc.), it falls back to a
stub and reports via `onOpenApiWalkError`:

```text
[@databehave/server] openapi walk failed for GET /api/v1/weird: $ref not found: #/components/schemas/Missing
```

The route stays usable (the stub body keeps clients happy) but the
gap is visible. The JSONC loader wires this to `console.warn` by
default; override with:

```ts
createServer({
  openapi: doc,
  onOpenApiWalkError: (method, path, err) => {
    // Fail CI on any walker error:
    throw err
  },
})
```

## Skipping OAS-declared routes

Routes that exist in `endpoints` (hand-written or static) are
automatically skipped by the walker — no extra configuration needed.
This is the recommended way to override an OAS path: declare it in
`endpoints` and the walker leaves it alone.

If you need to skip an OAS path without declaring a replacement
(e.g. a deprecated endpoint), declare it as an `EndpointResponse`
returning the deprecation message:

```jsonc
"endpoints": {
  "GET /api/v1/legacy": {
    "response": {
      "status": 410,
      "json": { "error": "gone", "message": "Use /api/v2/replacement" }
    }
  }
}
```

## Trust model

@databehave/server assumes the OpenAPI document comes from a **trusted source**
(your own repo, your own build pipeline). The walker passes `pattern` fields
straight to `new RegExp(...)` and that compiled regex is consulted by
`parse()` on incoming request bodies. A hostile OAS author could therefore
supply a catastrophic-backtracking pattern (e.g. `(a+)+b`) that would slow
down request validation against attacker-controlled input.

Mock-body generation (`mock()`) does **not** evaluate the regex, so simply
*loading* a hostile OAS is safe — but if you also turn on request-body
validation in front of untrusted input, validate or sandbox patterns from
untrusted OAS docs before passing them in.

### `pattern` requires a `maxLength` sibling

To make this concrete, the generator refuses to mock a string node
that declares a `pattern` without a `maxLength`. The boot-time error
is:

```text
@databehave/server/openapi: pattern at <pointer> requires a sibling maxLength to bound generation (ReDoS guard)
```

This is a hard guard, not a warning — fixing the OAS to add a
sensible `maxLength` is required before the kit will boot. The same
guard fires on nested string nodes, e.g. `items.pattern` inside an
array.

The `pattern` source itself is also length-capped at **1024
characters** in both the auto-schema translator and the request
validator. A pattern longer than the cap is rejected at boot with:

```text
@databehave/server/openapi: pattern length <N> exceeds cap of 1024 (ReDoS guard) (at <pointer>)
```

The cap exists because regex engines have super-linear behaviour on
sufficiently long pathological patterns even with `maxLength`-bounded
input — capping the pattern source is the cheap belt-and-braces.

## Admin route picker

The OAS document is also consumed by the admin panel. When
`admin.enabled`, the kit serves `GET {admin.path}/openapi-routes`
which returns `{ routes: { method, path, summary }[], discoveredAt }`
derived from the same OAS doc the walker uses. The admin UI calls this
endpoint to populate its route picker — no separate spec is needed.
See [../admin/rest-api.md](../admin/rest-api.md).
