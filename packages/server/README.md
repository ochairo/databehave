<!-- markdownlint-disable MD033 MD041 -->

<div align="center">

# @databehave/server

<b>A JSON file config-driven mock server</b>

[![npm version](https://img.shields.io/npm/v/@databehave/server.svg)](https://www.npmjs.com/package/@databehave/server)
[![CI](https://github.com/ochairo/databehave/actions/workflows/ci.yml/badge.svg)](https://github.com/ochairo/databehave/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A518.17-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

## Install

You can install `@databehave/server` alone but to get full functionality, the recommended companion is `@databehave/schema`.

```bash
npm install @databehave/schema @databehave/server
# or: pnpm add @databehave/schema @databehave/server
# or: yarn add @databehave/schema @databehave/server
```

> `@databehave/schema` is declared as an optional peer dependency. Install it alongside `@databehave/server` whenever you enable auto-schema mode.

## A 60-second tour

**1. OpenAPI specs driven data** — realistic mock data derived from your OpenAPI document, with zero config. See [docs/openapi.md](docs/openapi.md) for the `openapi` field reference.

**2. Auto-schema mode (`@databehave/schema`)** — realistic distributions, referential integrity, and deterministic seeding. See [docs/openapi/auto-schema.md](docs/openapi/auto-schema.md) for the `schema` field reference (knobs, defaults, install hint).

**3. Full custom data** — hand-write response generators as modules, and point routes to them. The module exports a function that receives the request and returns a response shape. You can use `@databehave/schema` or any other data source.

**4. Admin UI** You have a UI to override any route's response, with the override "sticking" until you remove it. No code change required for error injection.

```jsonc
{
  "server": {
    "host": "127.0.0.1",
    "port": "8000"
  },
  // 1. OpenAPI specs driven data
  "openapi": "./openapi.json",
  // 2. Auto-schema mode (Adds @databehave/schema data generation engine to OpenAPI specs)
  "schema": { "enabled": true },
  // 3. Full custom data
  "endpoints": {
    "GET /health": { "response": { "status": 200, "json": { "ok": true } } },
    "GET /products/list": "./src/routes/products/list.js",
    "POST /products/bulk-update": "./src/routes/products/bulk-update.js"
  },
  // 4. Admin UI: http://[server.host]:[server.port]/[admin.path]
  "admin": { "enabled": true, "path": "/databehave" },
}
```

## Documentation

### Start here

- [Index](docs/index.md) — package TOC and reading order.
- [Getting Started](docs/getting-started.md) — 5-step tutorial from install to a custom route.
- [Troubleshooting](docs/troubleshooting.md) — symptom → cause → fix.

### Reference

- [Config](docs/config/index.md) — every `databehave.json` field.
- [Config Validation](docs/config/validation.md) — opt-in inbound request validation (RFC 7807).
- [Admin](docs/admin/index.md) — admin UI, REST endpoints, matchers, ErrorMode, `x-mock-*` headers, scenarios, security notes.
- [OpenAPI](docs/openapi/fallback.md) — OAS fallback walker, [Auto-schema](docs/openapi/auto-schema.md), keyword parity.
- [CLI](docs/cli.md) — `@databehave/server` CLI reference.
- [Errors](docs/errors.md) — every user-visible error message, source-cited.

### Deeper

- [Design](docs/design.md) — architecture, dispatch pipeline, why the HTTP framework is hidden.
- [Stability](docs/stability.md) — public-surface lock, SemVer triggers, contract surfaces.
- [Recipes](docs/recipes.md) — error injection, static responses, programmatic hooks, in-process tests with `fetch()`.

<br /><br />
<div align="center">

© 2026-present ochairo. See [LICENSE](LICENSE)

</div>
