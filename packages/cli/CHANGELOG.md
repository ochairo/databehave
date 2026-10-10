# Changelog

## [Unreleased]

Upcoming package version: **0.2.0**. This section describes planned release contents, not a published release.

### Runtime requirements

- Require Node.js 24 or 26; support and test majors 24 and 26. Node.js 18, 20 and 22 are unsupported.

### Added

- `databehave` executable for explicit ESM configuration factories.
- Public `defineConfig` and `run` APIs, signal-driven shutdown, idle cleanup and failure exit codes.
- CLI ownership extracted from the previous server package; no implicit plugin discovery or installation.

See [migration](../../MIGRATION.md) and [release procedures](../../docs/releasing.md).
