# Changelog

## [Unreleased]

Upcoming package version: **0.2.0**. This section describes planned release contents, not a published release.

### Breaking changes

- Require Node.js 24.22.1+ within 24.x or 26.12.1+ within 26.x to enforce the updated security patch floors.
- Update dependencies to `@databehave/core` 0.2 and `@databehave/server` 0.3.
- Update the optional `@databehave/schema` peer range to `^0.3.0` for the schema adapter.

### Changed

- Refresh the shared build, test and release tooling dependencies.

See [migration](../../MIGRATION.md) and [release procedures](../../docs/releasing.md).

## [0.1.0]

### Runtime requirements

- Require Node.js 24 or 26; support and test majors 24 and 26. Node.js 18, 20 and 22 are unsupported.

### Added

- Explicit operation catalog, selectable response-generator providers, request validation and mock-status plugins.
- Separate `/schema` adapter receiving builders and a runtime explicitly; the default entry does not import schema.
- Selected declared success statuses, bodyless status handling and shared response generation for fault injection.
- Incremental request-body limits, required-body checks and problem-response documentation.

See [migration](../../MIGRATION.md) and [release procedures](../../docs/releasing.md).
