# `validation`

Opt-in inbound request validation against the OpenAPI document.
Disabled by default — when `validation` is omitted or
`validation.request !== true`, `server.fetch(Request)` is
byte-identical to the no-validation behaviour.

```jsonc
"validation": {
  "request": true,        // master switch; default false
  "maxBodyBytes": 102400  // default 100 KB (matches express body-parser)
}
```

Source: `src/types.ts:Config.validation`,
`src/middleware/request-validation.ts`,
`src/validation/validate.ts`.

## Field reference

### `validation.request` (boolean)

Master switch. Default `false`. When `true`, every inbound request
is matched against the OAS document and runs through the
build-time-compiled validators below before reaching the
dispatcher. Routes outside the OAS (hand-written `endpoints` keys
that have no matching OAS path) are passed through unchanged — the
validator has no contract to enforce.

### `validation.maxBodyBytes` (number)

Hard cap on the JSON request body size, measured in **UTF-8 bytes**
(not JS string length). Default `102400` (100 KB) — matches
express's body-parser default. Bodies above the cap are rejected
with `413 Payload Too Large` before `JSON.parse` runs. Raise only
if the OpenAPI document genuinely declares large request bodies.

Source: `src/middleware/request-validation.ts:42-46`,
`:300-380`.

## Validation pipeline

For every matching route (built once at server-creation,
re-used per request) the validator runs four steps in order:

1. **Security gate** — if the OAS declares a `security` block on
   the operation (or globally), at least one requirement must be
   satisfied. Failure → `401` with a `WWW-Authenticate` challenge.
   Schemes recognised: `http` (presence-only `Authorization: <scheme> …`
   match), `apiKey` (`in: header | query`; cookie schemes are
   ignored), `oauth2`, `openIdConnect` (presence-only
   `Authorization` check; full token introspection is out of scope
   for a zero-dep mock — layer it via `hooks.onRequest` if needed).
2. **Content-Type guard** — for routes whose `requestBody.content`
   declares only `application/json`, requests with a non-JSON
   `Content-Type` are rejected with `415`.
3. **Body parse + validate** — the body is read once, capped at
   `maxBodyBytes`, then `JSON.parse`-d. Parse failure → `400`. Any
   schema violations are collected as `Violation[]` and emitted in
   the `422` response. **Body validation is strict** — no type
   coercion. A JSON `"42"` will not satisfy a schema with
   `type: integer`.
4. **Param validation (with coercion)** — query, path, and header
   parameters arrive as strings on the wire and are coerced
   (`integer`, `number`, `boolean`) before validation. Required
   params missing from the request emit a `required`-keyword
   violation. Cookie parameters are ignored.

Source: `src/middleware/request-validation.ts:300-460`.

## RFC 7807 problem-detail response

All rejections use `Content-Type: application/problem+json` and the
shape:

```json
{
  "type": "https://github.com/ochairo/databehave/blob/main/docs/errors/<slug>.md",
  "title": "Request validation failed",
  "status": 422,
  "detail": "request validation failed (3 violations)",
  "violations": [
    { "path": "/body/items/0/sku", "keyword": "minLength", "message": "..." },
    { "path": "/query/page",       "keyword": "minimum",   "message": "..." },
    { "path": "/header/x-id",      "keyword": "required",  "message": "..." }
  ]
}
```

Source: `src/middleware/request-validation.ts:24-50` (slug map +
title map), `:240-280` (envelope builder).

| Status | `title` | `type` slug |
| --- | --- | --- |
| `400` | `Malformed request` | `malformed-body` |
| `401` | `Unauthorized` | `unauthorized` |
| `413` | `Payload too large` | `payload-too-large` |
| `415` | `Unsupported media type` | `unsupported-media-type` |
| `422` | `Request validation failed` | `request-validation` |

`violations` is omitted when empty (e.g. on `400` / `415` / `413`).
The `Violation` shape (`{ path, keyword, message }`) is documented
in `src/validation/validate.ts:Violation`. Each `path` is a
JSON-Pointer rooted at one of `/body`, `/query/<name>`, `/path/<name>`,
or `/header/<name>`.

## Validator scope

The hand-rolled validator is intentionally a JSON-Schema **subset**
(audit-it-yourself: ~600 LoC, zero dependencies). Supported
keywords: `type`, `enum`, `required`, `properties`,
`additionalProperties`, `items`, `pattern`, `minLength`,
`maxLength`, `minimum`, `maximum`, `exclusiveMinimum`,
`exclusiveMaximum`, `minItems`, `maxItems`, `$ref`
(intra-document only — `#/components/schemas/...`), `oneOf`,
`anyOf`, `allOf`, `discriminator`, `format` (`date`, `date-time`,
`email`, `uuid`, `uri`), and `nullable` (OAS 3.0) /
`["X","null"]` (OAS 3.1).

Unsupported keywords are **rejected at server-start, not runtime**:
`if`, `then`, `else`, `dependentSchemas`, `dependentRequired`,
`unevaluatedProperties`, `unevaluatedItems`, `contentEncoding`,
`contentMediaType`, `propertyNames`, `patternProperties`, and
remote (`http://…` / `https://…`) `$ref`. The same set is rejected
by the auto-schema translator (single source of truth on JSON
Schema parity).

Source: `src/validation/validate.ts:51-58` (unsupported set),
`:21-44` (supported set; mirrored in
`src/openapi/translate.ts`).

## Security guarantees

The validator is built to be hostile-input safe:

- **No `eval`, no `new Function`, no dynamic `require`** — pure
  recursion (`src/validation/validate.ts:18-23`).
- **Prototype-pollution guard** — input objects whose own keys
  include `__proto__` / `constructor` / `prototype` are rejected as
  per-property violations (`:50-56`).
- **ReDoS mitigation** — `pattern` length capped at 1024 chars;
  invalid regexes rejected at build time, never request time
  (`:42`).
- **Recursion depth cap 64** — both schema build (`$ref` cycles)
  and `deepEqual` (used to compare against `enum` choices)
  (`:38-41`).

## Cross-references

- Symptoms and diagnosis: [../troubleshooting.md](../troubleshooting.md).
- Verbatim error catalogue (status mapping, `WWW-Authenticate`,
  parser errors): [../errors.md](../errors.md).
- Which OAS keywords each pipeline accepts:
  [../openapi/keywords.md](../openapi/keywords.md).
- Trust model for OAS-author input (the validator's caps are part
  of it): [../openapi/fallback.md#trust-model](../openapi/fallback.md#trust-model).
- Bypass via custom handlers: a hand-written `endpoints` route
  receives the raw `Request` (post-security, post-content-type,
  post-body checks unless you opt out at the route level — but the
  route is still part of the validation universe). To skip
  validation entirely for a route, omit it from the OAS document.
