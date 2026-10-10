# Changelog

## [Unreleased]

Upcoming package version: **0.1.0**. This section describes planned release contents, not a published release.

### Runtime requirements

- Require Node.js 24 or 26; support and test majors 24 and 26. Node.js 18, 20 and 22 are unsupported.

### Added

- Explicit operation catalog, selectable response-generator providers, request validation and mock-status plugins.
- Separate `/schema` adapter receiving builders and a runtime explicitly; the default entry does not import schema.
- Selected declared success statuses, bodyless status handling and shared response generation for fault injection.
- Incremental request-body limits, required-body checks and problem-response documentation.

See [migration](../../MIGRATION.md) and [release procedures](../../docs/releasing.md).
