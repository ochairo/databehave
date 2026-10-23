# Changelog

## [Unreleased]

Upcoming package version: **0.2.0**. This section describes planned release contents, not a published release.

### Breaking changes

- Require Node.js 24.22.1+ within 24.x or 26.12.1+ within 26.x to enforce the updated security patch floors.

### Changed

- Refresh the shared build, test and release tooling dependencies.

See [migration](../../MIGRATION.md) and [release procedures](../../docs/releasing.md).

## [0.1.0]

### Runtime requirements

- Require Node.js 24 or 26; support and test majors 24 and 26. Node.js 18, 20 and 22 are unsupported.

### Added

- Typed versioned capabilities, explicit dependency validation and instance-local plugin registration.
- Synchronous setup/sealing and separate prepare, activate and open barriers.
- Idempotent startup/close, cancellation, ingress drain and reverse resource disposal with cleanup failure reporting.

See [migration](../../MIGRATION.md) and [release procedures](../../docs/releasing.md).
