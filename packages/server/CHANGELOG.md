# Changelog

All notable changes to `@databehave/server` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
