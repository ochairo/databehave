# Changelog

All notable changes to `@databehave/schema` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Upcoming package version: **0.3.0**. This section describes planned release contents, not a published release.

### Breaking changes

- Require Node.js 24.22.1+ within 24.x or 26.12.1+ within 26.x to enforce the updated security patch floors.
- Update the optional `@databehave/core` peer range to `^0.2.0` for plugin composition.

### Changed

- Refresh the shared build, test and release tooling dependencies.

See [migration](../../MIGRATION.md) and [release procedures](../../docs/releasing.md).

## [0.2.0]

### Breaking changes

- Require Node.js 24 or 26; support and test majors 24 and 26. Drop Node.js 18, 20 and 22.
- Replace the closed IR node union with open `SchemaNode` and built-in `StandardSchemaNode` contracts. Serialized IR
  version 2 records exact kind/behavior contracts; version 1 requires explicit migration.
- Allow plugin-defined issue codes and enforce primitive invariants during validation.

### Added

- Sealed instance-local kind and behavior registries, typed descriptors, scoped sampling and runtime methods for
  nested generation, validation, datasets, traversal, replay and serialization.
- `/runtime`, `/standard` and optional `/plugin` entry points. Standard convenience builders/functions remain available.
- Public plugin, runtime support and migration guides, plus runnable public API examples.

See [migration](../../MIGRATION.md) and [release procedures](../../docs/releasing.md).

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
