# Axis reference

Each axis is a method (or builder) that attaches metadata to a schema
node. The generator inspects all axes when producing a value; see the
[priority order](design.md#4-axis-priority).

> Notation: `S<T>` means a `Schema` whose `Infer<S>` is `T`.
> Methods marked **(chainable)** return a new schema preserving the
> original subclass — `int().min(0).weighted([...])` stays `NumberSchema`.

---

## 1. Distribution

Where values concentrate. Has three flavours; only one is active per
node (the latest call wins).

### `.weighted(pairs)` *(enum / literal only)*

```ts
enum_(['A', 'B', 'C']).weighted([
  ['A', 0.7],
  ['B', 0.2],
  ['C', 0.1],
])
```

- `pairs: ReadonlyArray<readonly [V, number]>` — weights need not sum to 1.
- Values not in the schema's value set are rejected at build time.

### `.typically(from, to)` *(number / int / decimal)*

```ts
int().min(0).max(100).typically(40, 60)
decimal(38, 19).min('0').max('100000').typically(60_000, 80_000)
```

- Uniform within `[from, to]`, which must be a subset of `[min, max]`.
- Use for "most of the time it sits here, but the bounds are still
  reachable" — outliers come from `.occasionally` / `.eventually`.

### `.normal(mean, stddev)` *(number / int)*

```ts
num().min(-3).max(3).normal(0, 1)
```

- Box-Muller transform, clipped to `[min, max]`.

---

## 2. Domain

Closed candidate set. Applies to validation as well as generation.

### `.in(values)`

```ts
str().in(['A', 'B', 'C'])
int().in([1, 3, 5, 7])
```

### `.in({ kind: 'lookup', fromField, map })`

```ts
str().in({
  kind: 'lookup',
  fromField: 'group',
  map: {
    A: ['T1', 'T2'],
    B: ['X', 'Y'],
  },
})
```

- `fromField` must be a *sibling* in the enclosing `obj({...})`.
- Generated and validated against `map[parent[fromField]]`.

---

## 3. Derived

Computed from sibling / root data. Never sampled.

### `.derivedFrom(fn)`

```ts
int().derivedFrom(ctx => (ctx.parent.qty as number) * (ctx.parent.price as number))
```

`fn: (ctx: GenContext) => unknown` where `GenContext` is:

```ts
{
  root:    unknown                    // the entire value being built
  parent:  Readonly<Record<string, unknown>>  // sibling object (immediate parent)
  index?:  number                     // nearest array index, if any
  input?:  Readonly<Record<string, unknown>>  // user-supplied context
  seed:    string                     // stable seed for this leaf
}
```

- Runs in a **second pass** within `obj({...})`: non-derived fields are
  generated first, derived last, so the callback sees all siblings.
- Must be deterministic. Use `seed` to derive sub-randomness, never
  `Math.random()` or `Date.now()`.
- For foreign-key references, prefer [`relate`](recipes.md#cross-dataset-foreign-keys).

---

## 4. Invariants

Predicates the value must satisfy.

### `.invariant(fn)` *(any schema)*

```ts
int().min(0).max(100).invariant(v => (v as number) % 2 === 0)
```

`fn: (value: unknown, ctx: GenContext) => boolean`. The generator
rejection-samples up to 100 attempts; failure → `SchemaConflictError`.

### `.correlate(fn)` *(`ObjectSchema` only)*

Typed multi-field invariant. The callback receives the full assembled
object with `Infer<typeof S>`:

```ts
const Range = obj({
  start: int().min(0).max(100),
  end:   int().min(0).max(100),
}).correlate(r => r.start <= r.end)   // r: { start: number; end: number }
```

---

## 5. Discriminated union (conditional shape)

```ts
import { discriminated, obj, literal, decimal } from 'databehave'

const Variant = discriminated('kind', {
  alpha: obj({ kind: literal('alpha'), score:  decimal(10, 4) }),
  beta:  obj({ kind: literal('beta'),  weight: decimal(10, 4) }),
})

type Variant = Infer<typeof Variant>
// { kind: 'alpha';   score:  string } | { kind: 'beta'; weight: string }
```

- Each branch's `key` field must be `literal(<key>)`.
- The validator picks the first branch whose `key` matches the input
  value; the generator samples one branch uniformly per call.

---

## 6. Dataset

A collection of records sharing a schema, identity keys, and aggregate
invariants. Same identity tuple → same row, cross-endpoint.

### `mockDataset(opts)`

```ts
const groups = mockDataset({
  name:      'groups',
  schema:    obj({ group_code: str(), region: str() }),
  identity:  ['group_code'],
  n:         5,
  invariants: [
    rows => rows.every(r => r.group_code.length === 2),  // aggregate
  ],
  input:     { now: '2026-05-22' },                     // exposed as ctx.input
  seedPrefix: 'demo',                                   // optional
})
```

Returns `Infer<typeof schema>[]`. Identical `identity` tuples between
calls produce identical rows.

---

## 7. Identity

Implemented by `mockDataset`'s `identity: readonly string[]` option.
After each row is generated, databehave computes a plain identity string
(sorted, no hashing) of the form:

```txt
'DATASET|<name>|key1=<value1>&key2=<value2>...'
```

Subsequent rows with the same identity values return the cached row.

For cross-dataset FK reference, use [`relate`](recipes.md#cross-dataset-foreign-keys).

---

## 8. Cadence overrides

### `.occasionally(value, p)`

Probabilistic override. With probability `p ∈ [0, 1]`, the produced
value is forced to `value`.

```ts
decimal(38, 19).min('0').max('100000')
  .typically(60_000, 80_000)
  .occasionally('0', 0.005)            // 0.5 % empty
```

Multiple `occasionally(...)` calls stack (checked in declaration order).

### `.eventually(value, every, offset?)`

Deterministic periodic override driven by `ctx.index`. Every `every`
rows (at row `offset + every * k`), the value is forced to `value`.

```ts
decimal(38, 19).min('0').max('100000')
  .typically(60_000, 80_000)
  .eventually('0', 30)                 // every 30 days, value resets to 0
```

- Requires `ctx.index` to be defined (i.e. the schema is inside an
  array). Otherwise the override is skipped.
- Runs **before** `.occasionally` in the cadence pipeline.

---

## Modifiers

Not axes, but commonly chained:

```ts
str().nullable()              // T → T | null
str().optional()              // marks key optional in obj({...})
int().default(0)              // returned when value is undefined
str().describe('Group code.')  // free-form metadata
```

All four are preserved through `withMods` and survive `fromIR`
round-trips.
