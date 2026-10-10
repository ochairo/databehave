# Seed & reproducibility

For the same schema, options, deterministic plugin implementations and runtime/numeric conditions,
generation produces identical output. This page
documents how `seed` flows through the generator and the helpers that
back it.

The high-level seed pipeline is restated in
[`design.md` §5](../design.md#5-determinism-model) for context; the
authoritative implementation lives in
[`src/runtime/runtime.ts`](../../src/runtime/runtime.ts) and
[`src/foundation/prng.ts`](../../src/foundation/prng.ts).

---

## `MockOptions.seed`

```ts
import { mock, str } from '@databehave/schema'

const a = mock(str(), { seed: 'order:42' })
const b = mock(str(), { seed: 'order:42' })
// a === b under the fixed conditions above.

const c = mock(str(), { seed: 0xdeadbeef })  // unsigned 32-bit int
```

`MockOptions.seed: string | number | undefined` — overrides the default
seed for one `mock()` call. Strings are hashed via FNV-1a 32-bit and
fed to `mulberry32`; numbers are coerced to `u32` and seed `mulberry32`
directly. Either form yields a `Rng` with period ≈ 2³².

Source:
[`src/runtime/runtime.ts`](../../src/runtime/runtime.ts) (`mock` seed/factory selection).

## Default seed string `'databehave'`

```ts
import { mock, str } from '@databehave/schema'

const x = mock(str())                          // implicit seed
const y = mock(str(), { seed: 'databehave' })  // identical
// x === y
```

When `MockOptions.seed` is omitted, the generator uses the literal
string `'databehave'`. This is intentional and stable — leaving `seed`
unset is **not** equivalent to "random"; identical schemas with no
seed will always produce identical output. Pass an explicit `seed` to
diversify across runs.

Source:
[`src/runtime/runtime.ts`](../../src/runtime/runtime.ts) (`options.seed ?? 'databehave'`).

## `mulberry32(seed)` and `rngFromString(s)`

```ts
import { mulberry32, rngFromString, seedFromString } from '@databehave/schema/internal'

const r1 = mulberry32(0xdeadbeef)
const r2 = rngFromString('order:42')          // == mulberry32(seedFromString('order:42'))

r1.next()   // ∈ [0, 1)
r1.int(0, 9)         // ∈ [0, 9] — RangeError on inverted/non-finite bounds
r1.pick(['a', 'b'])  // RangeError on empty array
```

`mulberry32(seed: number): Rng` is a tiny, fast 32-bit PRNG.
`rngFromString(s: string): Rng` is `mulberry32(seedFromString(s))`.
`seedFromString(s: string): number` is FNV-1a 32-bit. The generator
uses these internally; plugin authors who need a deterministic
sub-stream can import them from the `@databehave/schema/internal`
entry point. Kind and behavior callbacks already receive `context.rng` and `context.leafRng()`;
prefer these runtime-scoped services when authoring extensions.

`Rng.int` and `Rng.pick` throw `RangeError` on non-finite or inverted
bounds and on an empty pick array.

Source:
[`src/foundation/prng.ts`](../../src/foundation/prng.ts).

## Per-leaf reseed

`MockOptions.stableBy` re-seeds individual leaf samples without
disturbing the rest of the tree. See
[sampling.md#mockoptionsstableby](./sampling.md#mockoptionsstableby)
for the full API; it shares the seed pipeline documented here.

## Cross-platform limits

The uniform sampling path (`Rng.next` × IEEE-754 arithmetic) is
bit-exact across conforming JS engines. The Gaussian path used by
`.normal(...)` calls `Math.log` / `Math.sqrt` / `Math.cos`, which are
implementation-defined in ECMAScript — see
[distributions.md#cross-platform-caveat](./distributions.md#cross-platform-caveat).
This property of the uniform PRNG is not a blanket guarantee for complete schemas, custom callbacks or different
plugin versions. Runtime support on Node.js 24 and 26 does not promise identical output across those majors.
