# Changelog

All notable changes to `@databehave/schema` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-03

Initial public release of `@databehave/schema`.

### Added

- Schema vocabulary for distributions, domains, derived fields, invariants,
  exceptions, and relations.
- Deterministic generation engine with seeded PRNG (mulberry32) and
  string-keyed seeds.
- `mock`, `replay`, and `expectStable` for deterministic value generation.
- `parse` / `safeParse` runtime conformance with a closed, snapshot-locked
  `IssueCode` catalog (required `Issue.code` field).
- IR walker, plus `serializeSchema` / `deserializeSchema` envelope with
  `IR_VERSION` for cross-process / on-disk schemas.
- Capability gating that splits numeric vs continuous distributions and
  preserves type-level narrowing on `.weighted` / `.normal` / `.typically`.
- `./internal` subpath export for plugin authors.
