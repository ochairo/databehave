# databehave — Design Notes

The smallest possible explanation of *why* databehave is shaped the way it is.

## 1. The thesis

A **data schema** captures *how data behaves*, not just *what shape it has*.
A table schema (DDL, JSON Schema, even zod) is necessary but not sufficient:
it tells you `item_id` is an integer between 1 and 7, but not that items
1–3 belong to group "A" and items 4–7 belong to group "B", that the
quantity typically sits around 60–80 % of capacity, that a periodic
refresh every 30 days drives it to zero, and that the same
`(group, item, date)` tuple must always return the same row to every
API endpoint.

databehave lets you say all of that. One schema becomes:

- the **TypeScript type** (`Infer<typeof S>`),
- the **runtime validator** (`parse` / `safeParse`),
- the **realistic data generator** (`mock`, `mockDataset`).

## 2. Non-goals (and why)

| Non-goal | Reason |
| --- | --- |
| HTTP, framework, CLI | Already solved by Fastify / Express / msw etc. Adding them couples databehave to a stack. |
| OpenAPI ingestion / zod adapter | Belongs in *external* packages that consume databehave's IR. |
| NP-hard solver for conflicting axes | Predictable failure (`SchemaConflictError`) is more valuable than slow magic. |
| `Math.random()`, `Date.now()` inside generation | Breaks determinism — the single feature tests depend on. |
| Float-equality invariants | Use `decimal()`; floats are the wrong type for "exactly". |
| Circular `derivedFrom` chains | Not solvable; refactor your schema. |

These are *intentional*. Each one is a permanent design choice, not a
"someday" gap.

## 3. Architecture

```bash
┌────────────┐  build  ┌────────┐  walk   ┌──────────┐
│  Builders  │ ──────▶ │   IR   │ ──────▶ │ Plugins  │
└────────────┘         └────────┘         └──────────┘
       │                  │  ▲
       │                  │  │ fromIR
       │                  ▼  │
       │              ┌───────────┐
       └────────────▶ │ Generator │ ──▶ value
                      └───────────┘
                            │
                            ▼
                      ┌───────────┐
                      │ Validator │ ──▶ ok / issues
                      └───────────┘
```

- **Builders** (`obj`, `str`, `decimal`, …) are *user-facing convenience*.
  They produce a `Schema<T>` whose phantom `_type` carries the TS type
  and whose `_node` is a plain serializable `SchemaNode` (the IR).
- **IR** (`SchemaNode` + `Modifiers` + `Axes`) is the only contract the
  generator and validator see. It is JSON-serializable, inspectable,
  transformable. Builder classes never escape.
- **Generator** consumes IR + a seed and emits a value.
- **Validator** consumes IR + a value and emits a typed value or issues.
- **Plugins** consume IR via `walkSchema` and may emit IR back via
  `fromIR` (or compose existing builders).

This separation is what lets the project stay zero-dependency: builders,
generator, and validator each depend only on the IR types and the PRNG
helper.

*See also:* [generator/](./generator/index.md) (sampling pipeline),
[validator/](./validator/index.md) (`parse` / `safeParse`).

## 4. Axis priority

When the generator produces a value at a path, it consults axes in this
order (highest priority wins; lower-priority axes constrain candidate
sets, they do not override):

1. **Invariants** (single-record) — rejection sampling, up to
   `MAX_ATTEMPTS` (100). If still failing, `SchemaConflictError`.
2. **Identity** — handled by `mockDataset`; identity tuples are unique
   per call (collisions are re-sampled; if the identity domain is too
   small for `n`, the dataset throws).
3. **Derived** — `derivedFrom(ctx => …)` returns the value verbatim.
   Skips all sampling.
4. **Conditional shape** — `discriminated(key, map)` selects the branch
   by the discriminator (O(1)); `union` falls back to uniform branch
   choice.
5. **Domain** — `.in([…])` or `.in({ kind: 'lookup', … })`. Narrows the
   candidate set. If a `weighted` distribution is also declared, only
   weights whose value lives in the domain are used.
6. **Distribution** — `.weighted(…)`, `.typically(…)`, `.normal(…)`.
   Picks within the (domain ∩ type) set.
7. **Type defaults** — uniform within declared bounds.
8. **Modifier short-circuits** — `optional → undefined`, `nullable → null`,
   `default → defaultValue`. Off by default in `mock()`; enable per call
   via `MockOptions.modifierProbs`.

**Cadence overrides** (`occasionally`, `eventually`) stack *before* the
distribution stage. `eventually` (deterministic, periodic via `ctx.index`)
runs before `occasionally` (probabilistic, i.i.d.).

The trace collector (`createTrace()`) annotates every leaf with the axis
that won, so this priority is observable from tests.

*See also:* [generator/sampling.md#axis-priority](./generator/sampling.md#axis-priority)
(per-call API), [generator/sampling.md#rejection-sampling](./generator/sampling.md#rejection-sampling)
(`MAX_ATTEMPTS` budget),
[schema/bound-operators.md#axis-priority](./schema/bound-operators.md#axis-priority)
(DSL-side restatement).

## 5. Determinism model

```txt
topSeed   = rngFromString(options.seed ?? '')   ← FNV-1a → mulberry32
  ↓
  ↓ per-leaf reseed: rngFromString(`${path}|${identityHash}`)
  ↓
value
```

Seed derivation uses only `node:` builtins and IEEE-754 arithmetic
(`seedFromString` is FNV-1a 32-bit; `mulberry32` is a 32-bit integer PRNG).
The generator never reads the wall clock, the environment, the network,
or `Math.random()`. Identical `(seed, input)` always produces an
identical value tree under the same Node/V8 build.

**Cross-platform caveats.** The uniform sampling path uses only IEEE-754
arithmetic that is bit-exact across conforming engines. The `.normal(...)`
distribution relies on `Math.log`, `Math.sqrt`, and `Math.cos`, which are
implementation-defined in ECMAScript and may differ across V8 builds /
libm implementations — do not assume byte-equality of Gaussian samples
between platforms. `.typically(...)` and uniform sampling are bit-exact.

**Modifier short-circuits are opt-in.** Per-call probabilities for
`default` / `optional` / `nullable` live on `MockOptions.modifierProbs`
(all-zero by default) — see
[generator/sampling.md#mockoptionsmodifierprobs](./generator/sampling.md#mockoptionsmodifierprobs).

`expectStable(schema, opts)` is the executable form of this contract:
it generates twice and throws on divergence — see
[generator/trace-replay.md#expectstable](./generator/trace-replay.md#expectstable).

*See also:* [generator/seed.md](./generator/seed.md) (default seed,
`mulberry32` / `rngFromString`),
[generator/distributions.md#cross-platform-caveat](./generator/distributions.md#cross-platform-caveat)
(Gaussian-only deviation).

## 6. Identity model (datasets)

```ts
mockDataset({ name: 'Catalog', schema: Row, identity: ['group', 'item'], n: 7 })
```

- Each row is generated with a per-row sub-seed
  `${seedPrefix}:row:${i}:attempt:0`.
- After generation, the identity key
  `'DATASET|Catalog|group=...&item=...'` is computed (`identityKey()` from
  `foundation/hash.ts` — sorted, plain-string join, no hashing).
- Collisions return the previously cached row → identical identity tuples
  always produce the same value, regardless of which endpoint asked for
  it.
- Aggregate invariants run after the full row list is assembled; if any
  fail, `SchemaConflictError` is thrown (single attempt).

Cross-dataset foreign keys use `relate(rows, field)` as the
`derivedFrom` callback — selection is itself deterministic per seed.

## 7. Error model

Two error classes, both with structured `path`:

- **`ConformError`** — `parse()` failure. Carries `issues: Issue[]` with
  `{ path, message, expected?, received? }`. Designed for human-readable
  multi-issue reporting.
- **`SchemaConflictError`** — generator gave up. Carries `path` and an
  optional `hint`. Raised for unsatisfiable bounds, invariants that
  reject every sample, or aggregate dataset invariants that cannot hold.

Validation and generation never throw anything else; if you see another
error class, it's a bug.

*See also:* [validator/api.md#conformerror](./validator/api.md#conformerror)
(validator emission shape; `Issue` per failed check).

## 8. Why TypeScript-first

- `Infer<typeof S>` gives the exact type back — no parallel `type Foo`
  declaration to drift.
- `correlate(fn)` and `derivedFrom(ctx => ...)` get full type-checking
  on the assembled object / sibling shape.
- Strict-mode flags (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) are part of the public contract; they
  catch bugs in user schemas at compile time.

The library compiles to plain ESM JavaScript; consumers without
TypeScript still get the runtime API. Types live in the published
`dist/index.d.ts`.
