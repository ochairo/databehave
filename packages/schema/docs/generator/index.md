# Generator

The generator turns a `Schema` plus a deterministic seed into a
concrete value. The entry point is [`mock(schema, options?)`](./sampling.md#mock);
everything else on this page is a deeper cut into how that one call
behaves.

Reproducibility requires fixed schema, options, deterministic plugin implementations and runtime conditions.
Custom compositions call `runtime.mock`; root helpers use `standardRuntime`.
See the [determinism
overview](../design.md#5-determinism-model) in `design.md` — see
[trace-replay.md#expectstable](./trace-replay.md#expectstable) for the
test-time assertion.

Public exports are recorded in the package's `etc/` API reports. The
[runnable schema example](../../../../examples/schema.mjs) exercises the public runtime boundary.

- [sampling.md](./sampling.md) — `mock(...)`, `MockOptions`,
  `GenContext`, `ModifierProbs`, `StableByFn`, axis priority, and the
  `MAX_ATTEMPTS = 100` rejection-sampling cap.
- [seed.md](./seed.md) — seeded RNG, the default seed string
  `'databehave'`, and the `mulberry32` / `rngFromString` /
  `seedFromString` plumbing exposed under `@databehave/schema/internal`.
- [distributions.md](./distributions.md) — the `Distribution` IR
  union (`weighted` / `normal` / `typical`), the sampling math each
  one drives, and the cross-platform caveat for Gaussian samples.
- [trace-replay.md](./trace-replay.md) — `createTrace(...)`, the
  `TraceAxis` / `TraceEntry` / `TraceCollector` shapes, and
  `replay(...)` / `expectStable(...)`.

For the surrounding subsystems — the DSL itself, the validator, the
dataset layer, the IR plugin contract, and the stability / SemVer
contract — see the sibling pages in [`../`](../).
