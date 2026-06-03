# Troubleshooting

Symptoms a first-time user is most likely to hit, with the cause and
the fix. For the full catalogue of error messages (verbatim, with
source citations) see [errors.md](./errors.md).

## `[@databehave/server] Auto-schema mode is enabled … but the data-generation engine is not installed`

**Cause.** Your `databehave.jsonc` sets `"schema": { "enabled": true }`
but the optional peer `@databehave/schema` is not resolvable from
the server's working directory.

**Fix.** Install the peer, set `"schema": { "enabled": false }`,
or remove the `schema` field entirely to fall back to the zero-dep
OAS-only generator:

```sh
npm i @databehave/schema
# or: pnpm add @databehave/schema
# or: yarn add @databehave/schema
```

The native Node `Cannot find module` text is intentionally
suppressed — the install hint is the user-visible error. See
[openapi/auto-schema.md#missing-install-error](./openapi/auto-schema.md#missing-install-error)
and [errors.md](./errors.md) for the verbatim template.

## `EADDRINUSE: address already in use`

**Cause.** Another process already holds `server.port`.

**Fix.** Either stop the other process or change the port. The
config supports env-var interpolation, so a one-shot override is
cheap:

```jsonc
"server": { "host": "127.0.0.1", "port": "${MOCK_SERVER_PORT:8000}" }
```

```sh
MOCK_SERVER_PORT=8123 npx @databehave/server databehave.jsonc
```

See [config/server.md](./config/server.md).

## JSONC parse errors

**Symptom.** Boot fails with a `SyntaxError` or
`JSON Parse error: …` pointing at a position in `databehave.jsonc`.

**Cause.** The JSONC stripper accepts `// line`, `/* block */`, and
trailing commas — but the result must still be valid JSON. Common
sources: missing closing brace, smart quotes pasted from a doc
editor, an embedded TS expression where a value is expected.

**Fix.** Validate the file with any JSON linter after stripping
comments. Grammar reference:
[config/index.md#file-format](./config/index.md#file-format).

## `JSON-only spec loader. Convert YAML first…`

**Cause.** The `openapi:` field points at a `.yaml` / `.yml` file.
The loader is JSON-only by design (no YAML runtime dependency).

**Fix.** Convert once, then point at the JSON output:

```sh
yq -o=json openapi.yaml > openapi.json
```

See [openapi/fallback.md#input-format](./openapi/fallback.md).

## `failed to parse JSON OpenAPI document … Unexpected token …`

**Cause.** The file is JSON but not valid — common culprits are a
stray trailing comma (the OAS loader is strict JSON, unlike the
JSONC config), a leading byte order mark from a non-UTF-8 editor
(stripped automatically only if it's the very first byte), or a
bundler injecting metadata.

**Fix.** Run the file through `jq . openapi.json` to surface the
exact offset.

## `unsupported $ref` / `$ref not found`

**Cause.** The OAS document references a remote `$ref`
(`https://…`) or a `#/components/schemas/X` that does not exist.
Both the OAS-only generator and the auto-schema translator are
intra-document only — they will not fetch.

**Fix.** Inline the schema, or pre-bundle the spec with a tool
like `redocly bundle openapi.yaml`. See
[openapi/keywords.md](./openapi/keywords.md).

## `Unsupported JSON Schema keyword …` (auto-schema or validator)

**Cause.** The kit FAILS LOUD on JSON-Schema keywords it cannot
faithfully implement. Currently rejected:

`if`, `then`, `else`, `dependentSchemas`, `dependentRequired`,
`unevaluatedProperties`, `unevaluatedItems`, `contentEncoding`,
`contentMediaType`, `propertyNames`, `patternProperties`, and
remote (`http://…` / `https://…`) `$ref`.

**Fix.** Rewrite the schema using supported constructs, or restrict
the keyword to documents the kit does not translate (e.g. move it
to a response shape served by a hand-written `endpoints` handler,
which bypasses the translator). See
[errors.md](./errors.md) for the full unsupported-keyword catalogue.

## "My override didn't fire"

**Cause.** Override resolution priority is fixed:
`request header > exact route > path > global > mockMode > passthrough`.
A more-specific override wins. Stickies expire on
`expiresAt < Date.now()` and are otherwise persistent until
deleted.

**Fix.** Inspect `GET ${admin.path}/overrides` to see the
resolved set; look for a `x-mock-injected: <kind>:<source>` header
on the response — its presence proves an override fired and the
`source` field tells you which one. Reference:
[admin/overrides.md#sticky-override-resolution](./admin/overrides.md).

## CORS: my browser request is rejected even though the server is up

**Symptom.** The browser console reports
`No 'Access-Control-Allow-Origin' header is present`. Server logs
show the request arrived.

**Cause.** `cors.origin` is an allowlist (case-insensitive). When
the request `Origin` is not on the list the kit deliberately omits
the `Access-Control-Allow-Origin` response header — there is no
explicit reject; the browser does the rejection.

**Fix.** Add the origin to `cors.origin`, or set it to `"*"` for a
fully-open dev mock. See [config/cors.md](./config/cors.md).

## Validation rejection (`application/problem+json`)

**Symptom.** A request that the upstream accepts is rejected by
the kit with `400` / `401` / `413` / `415` / `422` and a
`content-type: application/problem+json` body.

**Cause.** `validation.request: true` is enabled and the request
fails one of the contract checks (auth, content-type, body size,
schema).

**Fix.** Read `body.violations` to locate the offending JSON-Pointer
path. To raise the body cap set
`validation.maxBodyBytes` (default `102400` / 100 KB). Full
contract: [config/validation.md](./config/validation.md).

## CLI: `unknown option(s)` / silent exit `2`

**Cause.** `@databehave/server` accepts only `--open` and `-h` /
`--help`. Any other flag is rejected and the process exits `2`
(bad usage). Missing positional `<config>` exits `2` for the same
reason.

**Fix.** Move custom flags into `databehave.jsonc` or
`createServer({...})`. See [cli.md](./cli.md).

## "Admin mode refuses to bind to `0.0.0.0`"

**Cause.** When `admin.enabled === true` the server enforces
loopback binding at `listen()` time unless `admin.bind: "any"`
is explicitly set. The admin panel exposes destructive operations
(override CRUD, scenarios, optionally `x-mock-destroy`); shipping
it on a routable interface is rejected as a footgun.

**Fix.** Bind to `127.0.0.1` / `::1` / `localhost`, or set
`admin.bind: "any"` to confirm intent. See
[admin/index.md#security-notes](./admin/index.md#security-notes).

## "I changed `seed` and the responses didn't change"

**Cause.** `schema.seed: "stable"` derives the per-request seed
from `${METHOD} ${path}|${sortedQuery}|${sortedParams}` — the value
of the `seed` field itself is irrelevant in stable mode. To rotate
the seed, switch to a number or to `"random"`.

**Fix.** Pick the mode you want:

```jsonc
"schema": { "enabled": true, "seed": 42 }       // fixed; same body forever
"schema": { "enabled": true, "seed": "stable" } // default; varies per route+input
"schema": { "enabled": true, "seed": "random" } // fresh every request
```

See [openapi/auto-schema.md](./openapi/auto-schema.md).
