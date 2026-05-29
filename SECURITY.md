# Security Policy

## Supported versions

Only the latest minor release receives security updates.

| Version | Supported |
| --- | --- |
| 0.3.x   | ✅        |
| < 0.3   | ❌        |

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.**

Please use GitHub's private vulnerability reporting:
<https://github.com/ochairo/databehave/security/advisories/new>

Include:

- A short description of the issue and its impact.
- Steps to reproduce (a minimal failing schema + `mock()` call is ideal).
- Affected version(s) and Node.js version.
- Any suggested fix or mitigation.

We aim to acknowledge reports within 3 business days and to publish a patched
release within 14 days of a confirmed report.

## Scope

`databehave` has **zero runtime dependencies** and only uses `node:crypto`. The
main attack surfaces we care about are:

- Non-deterministic output despite a fixed seed (correctness bug with
  security impact for test reproducibility).
- Schema/IR inputs causing unbounded CPU or memory consumption (DoS in
  build pipelines).
- `parse()` / `safeParse()` returning `ok: true` for values that violate
  the declared schema (validation bypass).

Issues outside this scope (e.g. behaviour of user-supplied `derivedFrom`
callbacks, third-party HTTP wrappers built on top of databehave) should be
reported to the relevant project.
