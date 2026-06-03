# Getting started

> If you have an OpenAPI document and want a mock server in 5
> minutes, you're in the right place.

This is the tutorial. For exhaustive option tables see
[config/](./config/index.md); for the CLI reference see
[cli.md](./cli.md); for the admin UI see
[admin/](./admin/index.md).

## Install

```sh
npm install @databehave/schema @databehave/server
# or: pnpm add @databehave/schema @databehave/server
# or: yarn add @databehave/schema @databehave/server
```

`@databehave/schema` is an optional peer — only required if you want
[auto-schema mode](./openapi/auto-schema.md). The server itself
keeps `dependencies: {}` and `peerDependencies: {}` (zero-dep
invariant).

## Step 1 — Write a minimal `databehave.jsonc`

Drop this next to your OpenAPI document. Both paths are resolved
relative to the directory of the config file.

```jsonc
{
  // Optional — but required if you want OAS-fallback responses or
  // auto-schema mode. JSON only; convert YAML up-front
  // (e.g. `yq -o=json openapi.yaml > openapi.json`).
  "openapi": "./openapi.json",

  // Optional — defaults to `127.0.0.1:3000`.
  "server": { "host": "127.0.0.1", "port": 8000 },

  // Required (may be empty). Routes you declare here always win
  // over any OAS fallback.
  "endpoints": {}
}
```

JSONC features supported: `// line` comments, `/* block */`
comments, trailing commas, and `${VAR}` / `${VAR:default}` env
interpolation in any string value. Full grammar:
[config/index.md#file-format](./config/index.md#file-format).

## Step 2 — Run

```sh
npx @databehave/server databehave.jsonc
```

The positional `<config>` is required — there is no implicit default
path. On boot the CLI prints:

```txt
[@databehave/server] listening on http://127.0.0.1:8000
```

`SIGINT` / `SIGTERM` shut down cleanly with exit code `0`. Boot
errors exit `1`; bad usage exits `2`. See [cli.md](./cli.md) for
all flags and exit codes.

## Step 3 — Hit an endpoint

For any path declared in your OAS document the server returns a
deterministic stub body derived from the response schema. Stubs are
`{}` for `GET` and `{ "success": true, "message": null }` for
mutations when no schema is available; otherwise the body comes
from the OAS-only generator (or the auto-schema engine, if enabled).

```sh
curl -i http://127.0.0.1:8000/anything-in-your-spec
```

Behaviour, status-pick rules, and the walker stub policy are
documented in [openapi/fallback.md](./openapi/fallback.md).

## Step 4 — Declare a custom route

When you need exact control of a response, list it under
`endpoints`. The shorthand `{ status, json }` form is enough for
static bodies — no handler module required:

```jsonc
{
  "openapi": "./openapi.json",
  "endpoints": {
    "GET /health": { "response": { "status": 200, "json": { "ok": true } } },
    "POST /widgets": "./src/routes/widgets/create.js"
  }
}
```

Hand-written `endpoints` always win over any OAS fallback or
auto-schema route at the same key. Full set of forms (string
handler, `{ handler, status }`, `{ response }`):
[config/endpoints.md](./config/endpoints.md).

## Step 5 — Enable auto-schema mode

If you want realistic, seeded mock data instead of the structurally
deterministic OAS-only stubs, opt in by adding a top-level `schema`
field. This requires `@databehave/schema` (already installed in
Step 1):

```jsonc
{
  "openapi": "./openapi.json",
  "schema": { "enabled": true }, // "enabled" gates auto-mode; defaults equivalent to { "seed": "stable" }
  "endpoints": {}
}
```

Long form, with knobs:

```jsonc
"schema": {
  "enabled": true,
  "seed": 42,        // number | "stable" | "random" — default "stable"
  "locale": "ja",    // forwarded to the engine as a future hint
  "arrayCount": 20   // default array length when OAS lacks minItems
}
```

If the peer is missing the server fails fast at startup with a
friendly install hint — never lazily on first request. Full
walkthrough: [openapi/auto-schema.md](./openapi/auto-schema.md).
The exact install-hint text and every other user-visible error
live in [errors.md](./errors.md).

## Where to next

| You want to … | Read |
| --- | --- |
| Override responses without code (UI + REST) | [admin/](./admin/index.md) |
| Inject errors via `x-mock-*` request headers | [admin/headers.md](./admin/headers.md) |
| Save and reload override sets | [admin/scenarios.md](./admin/scenarios.md) |
| Validate inbound requests against the OAS | [config/validation.md](./config/validation.md) |
| See every JSONC field | [config/](./config/index.md) |
| Diagnose an unexpected error | [errors.md](./errors.md) + [troubleshooting.md](./troubleshooting.md) |
| Use the kit programmatically (`createServer`, `run`) | [recipes.md](./recipes.md) |
| Understand the dispatch pipeline | [design.md](./design.md) |
