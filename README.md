<!-- markdownlint-disable MD033 MD041 -->

<div align="center">

# @databehave

<b>A schema for how data behaves, and a mock server that runs on it.</b>

[![CI](https://github.com/ochairo/databehave/actions/workflows/ci.yml/badge.svg)](https://github.com/ochairo/databehave/actions/workflows/ci.yml)
[![@databehave/schema](https://img.shields.io/npm/v/@databehave/schema?label=%40databehave%2Fschema)](https://www.npmjs.com/package/@databehave/schema)
[![@databehave/server](https://img.shields.io/npm/v/@databehave/server?label=%40databehave%2Fserver)](https://www.npmjs.com/package/@databehave/server)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

## What is databehave?

Most schema libraries describe what shape your data has. databehave describes how data *behaves* — distributions, domains, derived fields, invariants, exceptions, and cross-dataset relations — with a determinism model that keeps generated values consistent across requests and code changes.

That schema is one half of the project. The other half is a mock HTTP server that consumes it: point it at an OpenAPI document, opt into auto-schema mode, and the same vocabulary that drives your unit-test fixtures drives your mock responses. One mental model, two packages.

## 30-second tour

```bash
npm install --save-dev @databehave/server @databehave/schema
npx databehave-server databehave.jsonc
```

```jsonc
// databehave.jsonc
{
  "server":    { "host": "127.0.0.1", "port": 8000 },
  "openapi":   "./openapi.json",
  "schema":    { "enabled": true },
  "admin":     { "enabled": true },
  "endpoints": {
    // If you need to customize beyond auto generate response, you can add route modules here:
    // E.g. "GET /products/list": "./src/routes/products/list.js"
  }
}
```

Every path declared in `openapi.json` is now served at `http://127.0.0.1:8000`.
If you need full control over the generated responses, you can use `@databehave/schema` directly to define custom data generation logic.
The admin UI at `http://127.0.0.1:8000/databehave` gives you a dashboard to override response data for each API endpoint, with support for saving and sharing override scenarios.

## Repository layout

```bash
.
├── biome.config.js     # — Biome code formatter config
├── package.json        # — workspace root (private; not published)
├── pnpm-lock.yaml      # — pnpm lockfile
├── pnpm-workspace.yaml # — pnpm workspace config
└──  packages/          # — workspace packages
    ├── schema/         # — @databehave/schema (zero-dep schema + IR + generator)
    └── server/         # — @databehave/server (OpenAPI- or JSON-driven mock server)
```

## Documentation

- [`@databehave/schema` README](packages/schema/README.md) · [docs](packages/schema/docs/index.md)
- [`@databehave/server` README](packages/server/README.md) · [docs](packages/server/docs/index.md)
- [License](LICENSE)

## Need help?

Open a discussion and include your config, expected behavior, and actual behavior.<br />
Get support here: <https://github.com/ochairo/databehave/discussions>

## Show your support

If you find this project useful, please give it a star on GitHub. It helps a lot.

<br /><br />
<div align="center">

© 2026-present ochairo. See [LICENSE](./LICENSE)

</div>
