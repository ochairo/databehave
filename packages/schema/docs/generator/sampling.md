# Sampling — `mock()` and `MockOptions`

```ts
import { mock, obj, str, int } from '@databehave/schema'

const User = obj({ id: int().min(1), name: str().min(2).max(20) })
const u = mock(User, { seed: 'demo' })
//   ^ { id: number, name: string }  — Infer<typeof User>
```

`mock<S extends Schema>(schema: S, options?: MockOptions): Infer<S>` is
the generator's only entry point. It is deterministic: identical
`(schema, options.seed, options.input)` always produces an identical
value tree, and the returned type is exactly `Infer<typeof schema>`.

The runtime decision tree is the [axis priority
order](../schema/bound-operators.md#axis-priority); the timing
guarantee is in [seed.md](./seed.md); the math behind each
distribution branch is in [distributions.md](./distributions.md);
the trace + replay helpers live in
[trace-replay.md](./trace-replay.md).

Source:
[`src/generator/engine.ts`](../../src/generator/engine.ts).

---

## `mock(schema, options?)`

```ts
import { mock, str } from '@databehave/schema'

mock(str())                            // implicit seed 'databehave'
mock(str(), { seed: 'order:42' })      // explicit string seed
mock(str(), { seed: 0xdeadbeef })      // explicit u32 seed
```

Signature:

```ts
const mock: <S extends Schema>(schema: S, options?: MockOptions) => Infer<S>
```

The generator throws `SchemaConflictError` when an axis combination
is unsatisfiable (e.g. an invariant rejects every sample for
[`MAX_ATTEMPTS`](#rejection-sampling) attempts in a row, or
`int().min(10).max(5)`). Validation errors never come from `mock()` —
they come from [`parse(...)`](../validator/api.md#parse).

## `MockOptions`

```ts
type MockOptions = {
  readonly seed?: string | number
  readonly input?: Readonly<Record<string, unknown>>
  readonly index?: number
  readonly trace?: TraceCollector
  readonly stableBy?: StableByFn
  readonly modifierProbs?: ModifierProbs
  readonly prng?: (seed: number) => Rng
}
```

Every field is optional. `seed` is documented in
[seed.md](./seed.md#mockoptionsseed); `trace` in
[trace-replay.md#createtrace](./trace-replay.md#createtrace); the
remaining five are documented below.

Source:
[`src/generator/engine.ts`](../../src/generator/engine.ts) (`MockOptions`
type).

## `MockOptions.input` — caller-supplied context

```ts
import { mock, obj, str } from '@databehave/schema'

const Doc = obj({
  body:   str(),
  locale: str().derivedFrom(ctx => (ctx.input as { locale?: string })?.locale ?? 'en'),
})

mock(Doc, { seed: 's', input: { locale: 'ja-JP' } }).locale  // 'ja-JP'
```

`MockOptions.input: Readonly<Record<string, unknown>>` is a free-form
read-only bag exposed inside every callback as `ctx.input`. The
generator never inspects it; it is the canonical way to thread
request-scoped data (locale, current user, "now", etc.) into
`derivedFrom` / `invariant` / `correlate` callbacks without baking it
into the schema.

Source:
[`src/generator/engine.ts`](../../src/generator/engine.ts) (`makeCtx`,
`GenState.input`).

## `MockOptions.index` — top-level row index

```ts
import { mock, int } from '@databehave/schema'

const days = int().eventually(7, 0)  // every 7th sample is 0

mock(days, { seed: 's', index: 6 })  // 0 — `index` drives `eventually`
mock(days, { seed: 's', index: 7 })  // 0
```

`MockOptions.index: number` seeds `ctx.index` for the **top-level**
schema. Inside arrays the nearest enclosing array index wins, but the
top-level schema has no enclosing array, so `mockDataset` uses this
field to surface its per-row counter to `eventually` cadences and to
`derivedFrom` callbacks.

Source:
[`src/generator/engine.ts`](../../src/generator/engine.ts) (`rootIndex`
plumbing in `GenState`, `nearestNumericIndex`).

## `MockOptions.modifierProbs`

```ts
import { mock, str } from '@databehave/schema'

const tag = str().optional().nullable().default('untagged')

mock(tag)                                                // always a sampled string
mock(tag, { modifierProbs: { default: 1 } })             // always 'untagged'
mock(tag, { modifierProbs: { optional: 0.5, nullable: 0.5 } })
//                       ^ probabilistically returns undefined / null / sampled string
```

`MockOptions.modifierProbs: ModifierProbs` controls the per-modifier
short-circuit probability:

```ts
type ModifierProbs = {
  readonly default?:  number  // P(.default → defaultValue)
  readonly optional?: number  // P(.optional → undefined)
  readonly nullable?: number  // P(.nullable → null)
}
```

**Defaults are all-zero.** `mock()` always samples a real value for
the underlying type; the `.default` / `.optional` / `.nullable`
short-circuits never fire unless the caller opts in. Each probability
must lie in `[0, 1]` — anything outside that range throws
`RangeError`:

```ts
mock(str().optional(), { modifierProbs: { optional: 1.5 } })
//   ↑ RangeError: modifierProbs.optional must be in [0, 1], got 1.5
```

The order of evaluation is `default` → `optional` → `nullable`; the
first short-circuit that fires wins. When all three are zero (the
default), the field always samples through to the underlying type.
This is also where the build-time `.default(v)` modifier (see
[`schema/modifiers.md#default`](../schema/modifiers.md#default))
becomes observable at sample time.

Source:
[`src/generator/engine.ts`](../../src/generator/engine.ts) — see the
`DEFAULT_MODIFIER_PROBS = { default: 0, optional: 0, nullable: 0 }`
constant, the per-key `RangeError` validation, and the modifier
short-circuit block in `generateNode`.

## `MockOptions.stableBy`

```ts
import { mock, obj, str, int } from '@databehave/schema'

const Order = obj({ id: int(), customerEmail: str() })

const value = mock(Order, {
  seed: 'run-1',
  stableBy: ctx => {
    // path is encoded in `ctx.seed` (e.g. 'run-1:customerEmail')
    if (ctx.seed.endsWith(':customerEmail')) return 'pinned-email'
    return null   // fall back to the shared rng
  },
})
// value.customerEmail is identical across `seed` changes; value.id is not.
```

`MockOptions.stableBy: StableByFn` is a per-leaf reseed hook:

```ts
type StableByFn = (ctx: GenContext) => string | null | undefined
```

Returning a non-empty string reseeds **just that leaf** with
`rngFromString(`${key}:${path.join('.')}`)`; returning `null`,
`undefined`, or `''` falls back to the shared per-call `rng`.
Composite kinds (`object`, `array`, `tuple`, `union`,
`discriminated`) ignore the hook for shape decisions (length, branch
choice) — only their leaf children re-enter it. This is the
machinery behind "snapshot the same row across runs even when the
outer seed rotates."

Source:
[`src/generator/engine.ts`](../../src/generator/engine.ts) — see
`StableByFn`, `pickLeafRng`, and the `sampleByKind` leaf-rng wiring.

## `MockOptions.prng`

```ts
import { mock, int, type Rng } from '@databehave/schema'

const constantRng = (value: number): Rng => ({
  next: () => value,
  int: (lo, hi) => Math.floor(lo + value * (hi - lo + 1)),
  pick: <T,>(items: readonly T[]) => items[Math.floor(value * items.length)] as T,
})

mock(int().min(0).max(99), { seed: 7, prng: () => constantRng(0) })
//   ↑ exercises the lower-bound branch deterministically
```

`MockOptions.prng: (seed: number) => Rng` overrides the PRNG factory.
Default is `mulberry32`. When `seed` is a string the seed is hashed
via `seedFromString` before being handed to the factory; when `seed` is
a number the factory receives it as-is.

Useful for tests that need to inject a constant or recorded RNG to
exercise probability-driven branches deterministically. Production
callers should leave this unset — `mulberry32` is the seeded default
the determinism contract is calibrated against, and swapping it
perturbs the output sequence.

Source:
[`src/generator/engine.ts`](../../src/generator/engine.ts) — see the
`prngFactory = options.prng ?? mulberry32` wiring inside `mock()`.

## `GenContext`

```ts
type GenContext = {
  readonly root:   unknown
  readonly parent: Readonly<Record<string, unknown>>
  readonly index?: number
  readonly input?: Readonly<Record<string, unknown>>
  readonly seed:   string
}
```

`GenContext` is the value passed to every callback that the DSL
accepts a function for: `derivedFrom`, `invariant`, `correlate`,
`stableBy`, and the `pickBy` callback of
[`relate(...)`](../schema/bound-operators.md#in). All five fields are
readonly:

| Field    | Meaning |
| --- | --- |
| `root`   | The value tree being assembled. `undefined` while the root itself is still in flight. |
| `parent` | The immediate enclosing object's data (frozen empty object at the root). |
| `index`  | Nearest enclosing array index, falling back to `MockOptions.index` for the top-level schema. |
| `input`  | The frozen `MockOptions.input` bag. Absent when no `input` was supplied. |
| `seed`   | A path-scoped string seed `<rootSeed>:<path.join('.')>`. Stable across runs for a given `(seed, path)` pair. |

Source:
[`src/foundation/axes.ts`](../../src/foundation/axes.ts) (type),
[`src/generator/engine.ts`](../../src/generator/engine.ts) (`makeCtx`).

## Axis priority

When the generator produces a value at a path, it consults axes in
this order — the first one that fires returns:

1. Modifier short-circuits (`default` / `optional` / `nullable`),
   gated by [`modifierProbs`](#mockoptionsmodifierprobs). Off by
   default.
2. `derivedFrom` — bypasses sampling entirely.
3. `eventually` — deterministic periodic override (driven by
   `ctx.index`).
4. `occasionally` — probabilistic i.i.d. override.
5. Invariants — rejection-sample up to
   [`MAX_ATTEMPTS`](#rejection-sampling).
6. Domain (`in([...])` or `in({ kind: 'lookup', … })`).
7. Distribution (`weighted` / `normal` / `typical` — see
   [distributions.md](./distributions.md)).
8. Type defaults.

The DSL-side restatement, with build-time semantics, lives at
[`schema/bound-operators.md#axis-priority`](../schema/bound-operators.md#axis-priority);
the architectural overview lives at
[`design.md` §4](../design.md#4-axis-priority). Both paraphrase the
same source-of-truth comment block at the top of
[`src/generator/engine.ts`](../../src/generator/engine.ts).

## Rejection sampling

```ts
import { mock, int } from '@databehave/schema'

const evenSmall = int().min(0).max(10).invariant(v => (v as number) % 2 === 0)
mock(evenSmall, { seed: 's' })  // ok — half the candidates pass

// Unsatisfiable: throws SchemaConflictError after 100 attempts.
const impossible = int().min(0).max(10).invariant(v => (v as number) > 100)
// mock(impossible) → SchemaConflictError('invariant unsatisfied after 100 attempts',
//                                        path, 'relax the invariant or narrow the distribution / domain')
```

Single-record invariants are enforced by **rejection sampling** with a
hard cap of `MAX_ATTEMPTS = 100` attempts per leaf. After 100 rejects
the generator throws `SchemaConflictError` carrying the failing path
and the hint `'relax the invariant or narrow the distribution /
domain'`. A passing sample emits a trace entry of axis
`'invariant-pass'` with `attempts` set; an exhausted run emits
`'invariant-fail'` with `attempts: 100` (see
[trace-replay.md#trace-axes](./trace-replay.md#traceaxis)).

Source:
[`src/generator/engine.ts`](../../src/generator/engine.ts) (`MAX_ATTEMPTS`
constant, the invariant loop in `generateNode`).
