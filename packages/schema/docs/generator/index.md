# Generator

The generator turns a `Schema` plus a deterministic seed into a
concrete value. The entry point is [`mock(schema, options?)`](./sampling.md#mock);
everything else on this page is a deeper cut into how that one call
behaves.

The generator's contract is **(schema, seed, input) → value**: identical
inputs always produce identical output, on every machine, every run.
That contract is the executable form of the [determinism
overview](../design.md#5-determinism-model) in `design.md` — see
[trace-replay.md#expectstable](./trace-replay.md#expectstable) for the
test-time assertion.

Every entry on these pages mirrors a real export from
[`src/index.ts`](../../src/index.ts). Code samples type-check against
the actual source signatures — no synthetic API.

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
