# Changelog

All notable changes to `@databehave/server` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Upcoming package version: **0.3.0**. This section describes planned release contents, not a published release.

### Breaking changes

- Require Node.js 24.22.1+ within 24.x or 26.12.1+ within 26.x to enforce the updated security patch floors.
- Update the `@databehave/core` dependency to the 0.2 release line.

### Changed

- Refresh the shared build, test and release tooling dependencies.

See [migration](../../MIGRATION.md) and [release procedures](../../docs/releasing.md).

## [0.2.0]

### Breaking changes

- Require Node.js 24 or 26; support and test majors 24 and 26. Drop Node.js 18, 20 and 22.
- Replace `createServer` and server-owned JSONC/CLI assembly with core host composition and explicit HTTP plugins.
- Move OpenAPI, request validation, admin UI, fault controls and CLI ownership to their separate packages.
- Move the shared drain timeout to `httpPlugin`; HTTP owns both in-process requests and response stream lifetimes.

### Added

- Public route, middleware, bind-guard and route-source contracts with registration sealing and staged startup.
- Explicit Node transport, CORS and access logging plugins, authority validation, bounded shutdown and cancellation.
- Consistent HEAD fallback, response decoration, route precedence and single-outcome observation.

See [migration](../../MIGRATION.md) and [release procedures](../../docs/releasing.md).

## [0.1.0] - 2026-06-03

Initial public release of `@databehave/server`.

### Added

- JSON / JSONC config-driven mock HTTP server with hand-written and
  OpenAPI-derived routes.
- OpenAPI walker with auto-schema mode (optional `@databehave/schema` peer)
  for realistic, deterministic response data.
- Per-route override panel via opt-in admin UI; deterministic seeding
  knobs (fixed / `stable` / `random`).
- Per-request hooks (`onRequest`, `onResponse`, `onError`,
  `onServerError`), CORS, opt-in inbound request validation, opt-in
  access logs.
- Public API renamed to drop the `DataBehaveKit` prefix; request /
  response facades exposed as `MockRequest` / `MockResponse` to avoid
  shadowing `globalThis.Request` / `Response`.
- `seedFor` / `SeedInput` exported for callers deriving their own seeds.
