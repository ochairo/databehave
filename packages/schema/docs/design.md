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
| HTTP, framework, CLI in the standalone schema runtime | These belong to separate packages composed through the application host. |
| OpenAPI ingestion / zod adapter | Belongs in *external* packages that consume databehave's IR. |
| NP-hard solver for conflicting axes | Predictable failure (`SchemaConflictError`) is more valuable than slow magic. |
| `Math.random()`, `Date.now()` inside generation | Breaks determinism — the single feature tests depend on. |
| Float-equality invariants | Use `decimal()`; floats are the wrong type for "exactly". |
| Circular `derivedFrom` chains | Not solvable; refactor your schema. |

These boundaries keep the standalone schema runtime usable without an HTTP application.

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
  and whose `_node` is a `SchemaNode` (the IR).
- **IR** (`SchemaNode` + `Modifiers` + `Axes`) is the only contract the
  runtime descriptors see. It is inspectable and transformable. In-process axes may contain callbacks;
  serialization accepts only lossless JSON data and records required contracts in an explicit version 2 envelope.
- **Generator** consumes IR + a seed and emits a value.
- **Validator** consumes IR + a value and emits a typed value or issues.
- **Runtime** owns sealed, instance-local kind and behavior registries. Kind descriptors own generation,
  validation, traversal and reconstruction; behavior descriptors own their middleware and serialization.
- **Plugins** consume IR via `runtime.walkSchema` and reconstruct through `runtime.fromIR`, or compose builders.
  All recursive operations retain the selected runtime. Root convenience helpers bind `standardRuntime`.

The standalone runtime has no application-host or transport dependency. The optional `/plugin` adapter connects
it to `@databehave/core` when an application needs to expose a schema capability.

*See also:* [generator/](./generator/index.md) (sampling pipeline),
[validator/](./validator/index.md) (`parse` / `safeParse`).

## 4. Axis priority

Standard behavior execution follows these phase barriers:

1. **Modifiers** — `default`, `optional`, then `nullable`; generation probabilities default to zero.
2. **Derived** — return the callback's value without sampling.
3. **Cadence** — `eventually`, then `occasionally`.
4. **Invariants** — retry downstream sampling up to 100 times.
5. **Sampling** — domain candidates, distribution, then kind generation or a scoped fallback.

Modifier, derived and cadence short circuits bypass invariant sampling. Validation is separate and checks
primitive as well as composite invariants. Domain supplies candidates and a uniform fallback to downstream
distribution middleware; distribution owns weighting. Custom behaviors retain composition order within each phase.
Kind descriptors own composite branch selection. Dataset identity uniqueness is enforced after each row is generated.

The trace collector (`createTrace()`) annotates every leaf with the axis
that won, so this priority is observable from tests.

*See also:* [generator/sampling.md#axis-priority](./generator/sampling.md#axis-priority)
(per-call API), [generator/sampling.md#rejection-sampling](./generator/sampling.md#rejection-sampling)
(`MAX_ATTEMPTS` budget),
[schema/bound-operators.md#axis-priority](./schema/bound-operators.md#axis-priority)
(DSL-side restatement).

## 5. Determinism model

```txt
topSeed   = options.seed ?? 'databehave'   ← string seeds use FNV-1a → mulberry32
  ↓
  ↓ optional stableBy leaf reseed: rngFromString(`${key}:${path.join('.')}`)
  ↓
value
```

Seed derivation uses only `node:` builtins and IEEE-754 arithmetic
(`seedFromString` is FNV-1a 32-bit; `mulberry32` is a 32-bit integer PRNG).
The generator never reads the wall clock, the environment, the network,
or `Math.random()`. Identical schema, options and deterministic plugin implementations produce an
identical value tree under the same runtime/numeric conditions. External callbacks must honor that constraint.

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

`expectStable(schema, opts)` is a diagnostic smoke check:
it generates twice and throws on divergence, but cannot prove determinism — see
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
  `${seedPrefix ?? name}:row:${i}:attempt:${attempt}:dedup:${dedup}`.
- After generation, the identity key
  `'DATASET|Catalog|group=...&item=...'` is computed (`identityKey()` from
  `foundation/hash.ts` — sorted, plain-string join, no hashing).
- Collisions trigger fresh row samples, with eight candidates per row. There is no shared cross-call row cache.
- Aggregate invariants run after the full row list is assembled. Collision exhaustion or a rejected aggregate
  causes a full retry with new seeds, up to two dataset attempts; exhaustion throws `SchemaConflictError`.

Cross-dataset foreign keys use `relate(rows, field)` as the
`derivedFrom` callback — selection is itself deterministic per seed.

## 7. Error model

Two error classes, both with structured `path`:

- **`ConformError`** — `parse()` failure. Carries `issues: Issue[]` with
  `{ path, code, message, expected?, received? }`. Use `code` and `path` for machine matching;
  standard codes coexist with plugin-defined strings.
- **`SchemaConflictError`** — generator gave up. Carries `path` and an
  optional `hint`. Raised for unsatisfiable bounds, invariants that
  reject every sample, or aggregate dataset invariants that cannot hold.

Invalid metadata/registries can throw `TypeError`, invalid options can throw `RangeError`, and plugin errors can
propagate. Standard validation turns derived/invariant callback failures into issues; generation propagates them.

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
