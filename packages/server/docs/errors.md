# Error catalogue

Every user-visible error `@databehave/server` raises, grouped by
phase and module. Source citations are `file:line` relative to
`packages/server/`. The kit follows a **fail-loud** policy: shape
violations are caught at boot, not first request.

For symptom-driven guidance see [troubleshooting.md](./troubleshooting.md).
For the auto-schema install-hint walkthrough see
[openapi/auto-schema.md#missing-install-error](./openapi/auto-schema.md#missing-install-error).

## 1. JSONC config errors (`src/json-config.ts`)

Every entry below throws synchronously from
`loadConfig` and surfaces as a boot-time error.

| Message (verbatim, prefixed `@databehave/server/config:`) | When | Source |
| --- | --- | --- |
| `JSON root must be an object` | Top-level value of the file is not a JSON object. | `src/json-config.ts:441` |
| `"openapi" must be a string path` | `openapi:` not a string. | `src/json-config.ts:447` |
| `"server" must be an object` | `server:` not a plain object. | `src/json-config.ts:453` |
| `"basePath" must be a string` | `basePath:` not a string. | `src/json-config.ts:459` |
| `"basePath" must start with "/"` | First char of `basePath` is not `/`. | `src/json-config.ts:462` |
| `"basePath" must not end with "/"` | Trailing `/` on `basePath`. | `src/json-config.ts:465` |
| `"cors" must be an object` | `cors:` not a plain object. | `src/json-config.ts:471` |
| `"mockMode" must be an object` | `mockMode:` not a plain object. | `src/json-config.ts:477` |
| `"endpoints" must be an object` | `endpoints:` not a plain object. | `src/json-config.ts:531` |
| `"admin" must be an object` | `admin:` not a plain object. | `src/json-config.ts:541` |
| `"log" must be a boolean or an object` | Wrong type for `log:`. | `src/json-config.ts:552` |
| `"validation" must be an object` | `validation:` not a plain object. | `src/json-config.ts:560` |
| `endpoints["KEY"] must be a string or object` | Endpoint value is neither shorthand path nor `{ handler / response }`. | `src/json-config.ts:314` |
| `endpoints["KEY"] cannot have both "handler" and "response"` | Mutually exclusive shapes. | `src/json-config.ts:398` |
| `endpoints["KEY"] must have either "handler" or "response"` | Empty object value. | `src/json-config.ts:405` |
| `endpoints["KEY"].handler must be a string` | `handler` not a module path. | `src/json-config.ts:410` |
| `endpoints["KEY"].status must be a number` | Bad per-endpoint status. | `src/json-config.ts:416` |
| `endpoints["KEY"].status cannot be combined with "response" (put status inside response)` | `status` next to `response` instead of inside it. | `src/json-config.ts:422` |
| `endpoints["KEY"].response must be an object` | `response` not an object. | `src/json-config.ts:353` |
| `endpoints["KEY"].response.status must be a number` | `response.status` missing or not numeric. | `src/json-config.ts:358` |
| `endpoints["KEY"].response.empty must be a boolean` | `response.empty` not boolean. | `src/json-config.ts:366` |
| `endpoints["KEY"].response.headers must be an object` | `response.headers` not a plain object. | `src/json-config.ts:374` |
| `endpoints["KEY"].response.headers["H"] must be a string` | Non-string header value. | `src/json-config.ts:381` |
| `endpoints keys "A" and "B" both resolve to "C" after applying basePath` | Two endpoint keys collapse to the same `METHOD path` once `basePath` is prefixed. | `src/json-config.ts:683` |
| `MODULE (mapped to KEY) has no default-exported handler function` | Handler module did not `export default` a function. | `src/json-config.ts:314` |
| `handlers override for "MODULE" (mapped to KEY) is not a function (got TYPE)` | `LoadConfigOptions.handlers` value not callable. | `src/json-config.ts:297` |
| `endpoints["KEY"]` validation chain (32 sub-errors) | Aggregated via `AggregateError` so a multi-broken config surfaces every gap at once. | `src/json-config.ts:432`, `src/json-config.ts:715-735` |

## 2. OpenAPI loader / walker errors

| Message (verbatim) | When | Source |
| --- | --- | --- |
| `JSON-only spec loader. Convert YAML first: yq -o=json <file>.yaml > <file>.json` | `openapi:` points at `*.yaml` / `*.yml`. | `src/openapi/loader.ts:25` |
| `@databehave/server/openapi: failed to parse JSON OpenAPI document at PATH: <native message>` | `JSON.parse` failed on the OAS bytes (after BOM strip). | `src/openapi/loader.ts:34` |
| `@databehave/server/openapi: unsupported $ref: <ref>` | Remote `$ref` (`http://…` / `https://…`) or a `$ref` not pointing under `#/components/schemas/`. | `src/openapi/generate.ts:50` |
| `@databehave/server/openapi: $ref not found: <ref>` | Intra-document `$ref` whose target does not exist. | `src/openapi/generate.ts:55` |
| Generator: walker reached unsupported node type | Walker encountered a JSON-Schema construct without a fallback. | `src/openapi/generate.ts:44`, `:116` |

Walker errors do not always abort boot — when `onOpenApiWalkError` /
`onOpenApiEmptySchema` is configured the walker substitutes a stub
body (`{}` for GET, `{ "success": true, "message": null }` for
mutations) and emits a logged warning instead. See
[openapi/fallback.md#walker-failures](./openapi/fallback.md).

## 3. Auto-schema errors (`src/openapi/auto-schema.ts`)

| Message (verbatim, prefixed `@databehave/server/config:`) | When | Source |
| --- | --- | --- |
| `"schema" must be an object like \{ "enabled": true \}; the boolean shorthand was removed (got VALUE)` | `schema:` set to the removed boolean form (`true` / `false`). | `src/openapi/auto-schema.ts` |
| `"schema" must be an object like \{ "enabled": true \} (got TYPE)` | `schema:` set to a non-object value (and not the removed boolean shorthand). | `src/openapi/auto-schema.ts` |
| `"schema.enabled" must be a boolean (got VALUE)` | `schema:` is an object but `enabled` is missing or not boolean. | `src/openapi/auto-schema.ts` |
| `unknown key in "schema": "K" (valid keys: enabled, seed, locale, arrayCount)` | Unknown sub-key. | `src/openapi/auto-schema.ts` |
| `"schema.seed" must be a number, "stable", or "random" (got VALUE)` | Bad `seed` value. | `src/openapi/auto-schema.ts` |
| `"schema.locale" must be a string` | Non-string `locale`. | `src/openapi/auto-schema.ts` |
| `"schema.arrayCount" must be a non-negative number` | Negative or non-finite `arrayCount`. | `src/openapi/auto-schema.ts` |

### Missing install error (`INSTALL_HINT`)

When `schema.enabled === true` but `@databehave/schema` cannot be
resolved the server suppresses the native `Cannot find module`
text and throws this verbatim template (no `cause` chain — by
design):

```text
[@databehave/server] Auto-schema mode is enabled in databehave.jsonc
("schema": { "enabled": true } is set), but the data-generation engine is not installed.

  npm i @databehave/schema
  # or: pnpm add @databehave/schema
  # or: yarn add @databehave/schema

This enables realistic, seeded mock data derived from your OpenAPI
document. See: https://github.com/ochairo/databehave/blob/main/packages/server/docs/openapi/auto-schema.md#missing-install-error

To keep the default zero-dep placeholder mode instead, set
"schema": { "enabled": false } or remove the "schema" field from databehave.jsonc.
```

Source: `src/openapi/auto-schema.ts` (`INSTALL_HINT` constant) and
`loadSchemaModule` (throw site).

## 4. Validator build-time errors (`src/validation/validate.ts`)

The validator FAILS LOUD at server-start on any unsupported
JSON-Schema keyword — there is no silent passthrough. The same
keyword set is rejected by the auto-schema translator
(`src/openapi/translate.ts`).

Rejected keywords: `if`, `then`, `else`, `dependentSchemas`,
`dependentRequired`, `unevaluatedProperties`, `unevaluatedItems`,
`contentEncoding`, `contentMediaType`, `propertyNames`,
`patternProperties`. Remote `$ref` is also rejected.

Pattern length is capped at **1024 characters** (ReDoS guard);
recursion depth at **64 levels** (`$ref` cycles, deeply-nested
schemas). Both caps surface as build-time errors prefixed
`@databehave/server/validation:` and pointing at the offending
JSON-Pointer.

## 5. Runtime errors

| Message (verbatim) | When | Source |
| --- | --- | --- |
| `@databehave/server: invalid route key (missing space): "KEY"` | Route key without the `METHOD path` space separator. | `src/route-key.ts:52` |
| `@databehave/server: invalid route key …` (unsupported method, bad path, etc.) | Five further per-shape rejections. | `src/route-key.ts:56,64,71,97,100` |
| `@databehave/server: empty param name in path "PATH"` | `:` followed by no name. | `src/route-key.ts:97` |
| `@databehave/server: duplicate route declared: KEY` | Two route entries collide post-`basePath`. | `src/server.ts:136` |
| `@databehave/server: admin is enabled and server.host=… — set admin.bind: "any" to confirm this is intentional, or bind to loopback (127.0.0.1, ::1, localhost). See README "Admin mode".` | Admin mode + non-loopback `host`. | `src/server.ts:511` |
| `@databehave/server: invalid scenario name: "NAME"` | Scenario name fails `^[A-Za-z0-9_-]{1,64}$`. | `src/admin/scenarios-store.ts:97` |
| `admin.path` must start with `/` | Bad admin path. | `src/admin/admin-routes.ts:318` |
| MockResponse shape violation | Handler returned a body that violates the discriminated-union (`json` / `text` / `html` / `raw` / `empty` — exactly one). | `src/response.ts:33` |
| Admin route collision with user route | A hand-written `endpoints` key collides with the admin sub-tree at `${admin.path}`. | `src/server.ts:289` |
| Validation rejection (`application/problem+json`) | See section 6. | `src/middleware/request-validation.ts` |

### `x-mock-*` header parser errors

All raise `400 Bad Request` with a JSON envelope of shape
`{ "error": "...", "detail": "..." }`. Verbatim error wording
ships from `src/admin/header-parser.ts:44,53,64,77,97,110`.

| Trigger | Resulting shape |
| --- | --- |
| Invalid base64 in `x-mock-business-failure-b64` / `x-mock-business-failure-extra` | `400 { error, detail }` |
| Invalid JSON in `x-mock-business-failure-extra` | `400 { error, detail }` |
| `x-mock-status` not a 200–600 integer | `400 { error, detail }` |
| Conflicting terminal headers (e.g. `x-mock-status` + `x-mock-empty`) | `400 { error, detail }` |
| `x-mock-delay-then` set to `delay` / `hang` / `destroy` | `400 { error, detail }` |
| `x-mock-business-failure-extra` decoded to a non-object | `400 { error, detail }` |

Reference: [admin/headers.md](./admin/headers.md),
[admin/error-mode.md](./admin/error-mode.md).

## 6. Validation runtime rejections (RFC 7807)

When `validation.request: true` is set, off-contract requests are
rejected with `application/problem+json`. Status mapping:

| Status | Cause |
| --- | --- |
| `400` | Malformed JSON body (parse failure). |
| `401` | Required security scheme not satisfied (`http`, `apiKey`, `oauth2`, `openIdConnect`). Includes a `WWW-Authenticate` challenge header. |
| `413` | Request body exceeds `validation.maxBodyBytes` (default `102400`). |
| `415` | Request body content-type is not declared by the spec for this route (when the route is JSON-only). |
| `422` | Schema violation. Body includes a `violations: Violation[]` array, each entry `{ path, keyword, message }` keyed by JSON-Pointer. |

Source: `src/middleware/request-validation.ts:24-50` (status
mapping), `:42-46` (default `maxBodyBytes`), `:300-450` (dispatch).
Full surface: [config/validation.md](./config/validation.md).

## 7. CLI errors (`src/bin.ts`, `src/bin-helpers.ts`)

| Output | Exit | When |
| --- | --- | --- |
| `[@databehave/server] unknown option(s): <flag>` (then `HELP_TEXT` to stderr) | `2` | Any flag other than `--open` / `-h` / `--help`. |
| `HELP_TEXT` to stderr (no error line) | `2` | Missing positional `<config>`. |
| `[@databehave/server] failed to start <error>` | `1` | Bootstrap exception (config load, listen failure, etc.). |
| `[@databehave/server] failed to close <error>` | `1` | `RunHandle.close()` rejected during shutdown. |
| `[@databehave/server] shutting down (SIGINT|SIGTERM)` (info) | `0` | Graceful shutdown. |

`HELP_TEXT` source: `src/bin-helpers.ts:18-23`. Reference:
[cli.md](./cli.md).

## 8. Admin destroy signal (internal)

`AdminDestroySocketSignal` is thrown when a request bearing the
`x-mock-destroy` header — and `admin.allowDestroy === true` —
reaches `fetch()` outside `listen()`. Inside `listen()` the signal
is caught by the Node http adapter, which destroys the underlying
socket without writing a response. Outside `listen()` (i.e. tests
calling `server.fetch(req)` directly) the signal escapes by design
so the test can assert on it.

Source: `src/admin/admin-types.ts:23-28`,
`src/server.ts:565-572`.
