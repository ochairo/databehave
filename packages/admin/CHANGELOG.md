# Changelog

## [Unreleased]

Upcoming package version: **0.1.0**. This section describes planned release contents, not a published release.

### Runtime requirements

- Require Node.js 24 or 26; support and test majors 24 and 26. Node.js 18, 20 and 22 are unsupported.

### Added

- Explicit fault-injection, admin UI/API and optional browser-opening plugins extracted from server ownership.
- Route discovery through the resolved HTTP catalog, feature-owned CORS and default loopback bind restrictions.
- Public scenario-store contract and explicit file adapter, validated atomic fault-state replacement and versioned saves.
- Cancellation-aware delay/hang faults and explicit transport termination.

See [migration](../../MIGRATION.md) and [release procedures](../../docs/releasing.md).
