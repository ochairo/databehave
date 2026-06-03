# `@databehave/server` documentation

Reading order by audience:

**Start here**

- [getting-started.md](./getting-started.md) — 5-step tutorial from `npm install` to a custom route.
- [troubleshooting.md](./troubleshooting.md) — symptom → cause → fix.

**Reference**

- [config/](./config/index.md) — every JSONC field.
- [config/validation.md](./config/validation.md) — opt-in inbound request validation (RFC 7807).
- [admin/](./admin/index.md) — admin panel, REST API, `x-mock-*` headers.
- [openapi/](./openapi/fallback.md) — OAS fallback, auto-schema mode, keyword parity.
- [cli.md](./cli.md) — `@databehave/server` CLI.
- [errors.md](./errors.md) — every user-visible error message, source-cited.

**Deeper**

- [design.md](./design.md) — architecture, dispatch pipeline, why the HTTP framework is hidden.
- [stability.md](./stability.md) — public-surface lock, SemVer triggers, contract surfaces.
- [recipes.md](./recipes.md) — error injection, static responses, programmatic hooks, in-process tests.
