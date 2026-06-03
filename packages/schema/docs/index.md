# `@databehave/schema` documentation

Reading order by audience:

**Start here**

- [getting-started.md](./getting-started.md) — install + 5-minute hello-world.
- [../README.md](../README.md) — 60-second tour of the DSL.

**Reference**

- [schema/](./schema/index.md) — DSL: primitives, composites, modifiers, bound operators.
- [generator/](./generator/index.md) — `mock`, seeds, distributions, traces, replay.
- [validator/](./validator/index.md) — `parse` / `safeParse` and the conformance axes.
- [dataset/](./dataset/index.md) — `mockDataset`, identity, cross-dataset `relate`.
- [foundation/](./foundation/index.md) — callable types, axis shapes, error hierarchy.
- [errors.md](./errors.md) — every error class, source-cited.

**Deeper**

- [design.md](./design.md) — architecture, axis priority, the determinism model.
- [recipes.md](./recipes.md) — practical patterns: FK, cadence, lookup domains.
- [extending.md](./extending.md) — plugin author guide (IR walker, `fromIR`, PRNG).
- [stability.md](./stability.md) — public-surface lock, SemVer triggers, contract surfaces.

**Project**

- [axes.md](./axes.md) — historical per-axis reference; new readers should prefer [schema/bound-operators.md](./schema/bound-operators.md).
