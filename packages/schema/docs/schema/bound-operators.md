# Bound operators

Operators that depend on the schema's kind. They split into two
families:

- **Numeric / string / array constraints** that narrow the value-set
  at build time (string `min` / `max` / `pattern`, number `min` /
  `max`, decimal `min` / `max`, array `length` / `min` / `max`).
- **Axes** — sampling and conformance metadata attached under
  `_node.mods.axes`. The generator inspects axes during sampling; the
  validator inspects only `domain` (since distributions are sampling
  hints, not conformance constraints).

Cross-kind compatibility is enforced by the
[capability matrix](#capability-matrix) — applying an operator the
schema does not support throws `SchemaConflictError` at build time
with a redirect hint. The order in which the generator evaluates axes
is documented under [Axis priority](#axis-priority).

> Notation. `S<T>` means a `Schema` whose `Infer<S>` is `T`. Methods
> below are chainable: `int().min(0).weighted([...])` stays a
> `NumberSchema`.

---

## String bounds

```ts
import { str } from '@databehave/schema'

const code = str().min(2).max(8)
```

`StringSchema.min(n: number): StringSchema` and
`StringSchema.max(n: number): StringSchema` set rune-count (codepoint)
bounds — not byte length. They store onto `_node.min` / `_node.max`.

Source:
[`src/schema/primitives.ts`](../../src/schema/primitives.ts).

## String `.pattern`

```ts
import { str } from '@databehave/schema'

const skuRe = str().pattern(/^[A-Z]{3}-\d{4}$/)
const sku   = str().pattern('^[A-Z]{3}-\\d{4}$')   // string form
```

`StringSchema.pattern(re: RegExp | string): StringSchema` — stores
`re.source` (or the raw string) onto `_node.pattern`. The IR value is
the regex source as a string, so it round-trips through serialization
without depending on a runtime `RegExp` object.

Source:
[`src/schema/primitives.ts`](../../src/schema/primitives.ts).

## Number bounds

```ts
import { num, int } from '@databehave/schema'

const score = num().min(-3).max(3).normal(0, 1)
const qty   = int().min(0).max(100)
```

`NumberSchema.min(n: number): NumberSchema` and
`NumberSchema.max(n: number): NumberSchema` — inclusive bounds for both
the continuous (`num()`) and integer (`int()`) variants. They set
`_node.min` / `_node.max` on the IR.

Source:
[`src/schema/primitives.ts`](../../src/schema/primitives.ts).

## Decimal bounds

```ts
import { decimal } from '@databehave/schema'

const amount = decimal(38, 19).min('0').max('100000')
const ratio  = decimal(10, 4).min(0).max(1)              // numbers ok
```

`DecimalSchema.min(value: string | number): DecimalSchema` and
`DecimalSchema.max(value: string | number): DecimalSchema` — accept
either a numeric string or a `number`; the bound is stored as a string
via `String(value)` to preserve precision.

Source:
[`src/schema/decimal.ts`](../../src/schema/decimal.ts).

## Array bounds

```ts
import { arr, int } from '@databehave/schema'

const exact   = arr(int()).length(5)
const between = arr(int()).min(1).max(8)
```

`ArraySchema<S>.length(n: number)`, `.min(n: number)`, `.max(n: number)`
all return a fresh `ArraySchema<S>`. Internally they call a private
`rebuild()` that constructs a new IR node with the bounds patched and
**re-grafts every previously-attached modifier** (axes, `describe`,
`optional`, `nullable`, `weighted` on the array element, etc.).
Without this, chaining `arr(int()).typically(1, 5).min(2)` would
silently drop the distribution; the rebuild guarantees the final
schema preserves every modifier set on any link of the chain.

Source:
[`src/schema/composites.ts`](../../src/schema/composites.ts).

## Capability matrix

Not every operator applies to every kind. When a caller chains an
unsupported combination, the builder throws a `SchemaConflictError` at
schema-build time (not at sample time), with a redirect hint pointing
at the correct operator:

| Kind       | Forbidden operator                            | Redirect to                                                |
| ---------- | --------------------------------------------- | ---------------------------------------------------------- |
| `str`      | `.normal`, `.typically`                       | `.weighted([['a', 1], ['b', 2]])` for biased string choice |
| `decimal`  | `.weighted`                                   | `.in([...])` or `enum_([...]).weighted([...])`             |
| `obj`      | `.weighted`, `.normal`, `.typically`          | apply to the specific field                                |
| `arr`      | `.weighted`, `.normal`, `.typically`          | apply to the element schema                                |
| `tuple`    | `.weighted`, `.normal`, `.typically`          | apply to a specific element                                |
| `union`    | `.weighted`, `.normal`, `.typically`          | use [`discriminated`](./composites.md#discriminated)       |

Failing loud at build time means the misuse surfaces in the unit test
that constructs the schema, not in production telemetry. The matrix is
the canonical source of fail-loud rules — see also
[`../stability.md`](../stability.md) for the broader fail-loud policy.

Source: per-kind `override` throws across
[`src/schema/primitives.ts`](../../src/schema/primitives.ts),
[`src/schema/decimal.ts`](../../src/schema/decimal.ts), and
[`src/schema/composites.ts`](../../src/schema/composites.ts).

---

## Axes

Each axis is metadata on `_node.mods.axes`. Only one `distribution`
is active per node (latest call wins); `occasionally` and `eventually`
overrides stack; `derived`, `invariants`, and `domain` apply
independently.

### `.weighted`

```ts
import { enum_ } from '@databehave/schema'

const tier = enum_(['A', 'B', 'C']).weighted([
  ['A', 0.7],
  ['B', 0.2],
  ['C', 0.1],
])
```

`Schema<T>.weighted(weights: ReadonlyArray<readonly [V, number]>):
this` where `V` is `T & (string | number | boolean)`. Weights are
relative — they need not sum to 1. Values not in the schema's
candidate set are rejected at build time. Applies to enum, literal,
and primitive discrete schemas; rejected on `decimal` / `obj` / `arr`
/ `tuple` / `union` (see [Capability matrix](#capability-matrix)).

Source:
[`src/foundation/types.ts`](../../src/foundation/types.ts).

### `.normal`

```ts
import { num } from '@databehave/schema'

const z = num().min(-3).max(3).normal(0, 1)
```

`Schema<T>.normal(mean: number, stddev: number): this` — Gaussian
sampling via Box–Muller, clipped to `[min, max]` if either bound is
set. Applies to `num()` and `int()`; rejected on `str`, `obj`, `arr`,
`tuple`, `union`.

Source:
[`src/foundation/types.ts`](../../src/foundation/types.ts).

### `.typically`

```ts
import { int, decimal } from '@databehave/schema'

const usage = int().min(0).max(100).typically(40, 60)
const price = decimal(38, 19)
  .min('0').max('100000')
  .typically(60_000, 80_000)
```

`Schema<T>.typically(from: number, to: number): this` — samples
uniformly inside `[from, to]`, which must be a subset of the
schema's `[min, max]`. Outliers reach the broader range only via
[`.occasionally`](#occasionally) / [`.eventually`](#eventually).
Applies to `num()`, `int()`, and `decimal(...)`.

Source:
[`src/foundation/types.ts`](../../src/foundation/types.ts).

### `.occasionally`

```ts
import { decimal } from '@databehave/schema'

const amount = decimal(38, 19)
  .min('0').max('100000')
  .typically(60_000, 80_000)
  .occasionally('0', 0.005)            // 0.5 % zero
```

`Schema<T>.occasionally(value: T, p: number): this` — with probability
`p ∈ [0, 1]`, the produced value is forced to `value`. `p` outside
`[0, 1]` throws `RangeError` at build time. Multiple
`occasionally(...)` calls stack and are checked in declaration order
**before** the base distribution.

Source:
[`src/foundation/types.ts`](../../src/foundation/types.ts).

### `.eventually`

```ts
import { decimal } from '@databehave/schema'

const ledger = decimal(38, 19)
  .min('0').max('100000')
  .typically(60_000, 80_000)
  .eventually(30, '0')                 // every 30 rows: 0
```

`Schema<T>.eventually(every: number, value: T, opts?: { readonly
offset?: number }): this` — deterministic periodic override driven by
`ctx.index`. At rows `(opts.offset ?? 0) + every * k` (for `k = 0, 1,
2, …`) the value is forced to `value`. Skipped silently when
`ctx.index` is undefined (i.e. the schema is not inside an array).
`every` must be a positive integer or it throws `RangeError`.
Runs **before** [`.occasionally`](#occasionally) in the cadence
pipeline.

Source:
[`src/foundation/types.ts`](../../src/foundation/types.ts).

### `.derivedFrom`

```ts
import { obj, int, str } from '@databehave/schema'

const Line = obj({
  qty:   int().min(1).max(10),
  price: int().min(100).max(900),
  total: int().derivedFrom(ctx =>
    (ctx.parent.qty as number) * (ctx.parent.price as number),
  ),
})
```

`Schema<T>.derivedFrom(fn: DerivedFn): this` where
`DerivedFn = (ctx: GenContext) => unknown`. The field's value is
**computed**, never sampled. The callback must be deterministic — derive
sub-randomness from `ctx.seed`, never from `Math.random()` or
`Date.now()`.

`GenContext` exposes:

```ts
{
  readonly root:    unknown                                      // entire value being built
  readonly parent:  Readonly<Record<string, unknown>>            // immediate sibling object
  readonly index?:  number                                       // nearest enclosing array index
  readonly input?:  Readonly<Record<string, unknown>>            // caller-supplied context
  readonly seed:    string                                       // stable seed for this leaf
}
```

Inside `obj({...})`, derived fields run in a **second pass** after the
non-derived fields are sampled, so the callback sees every sibling.

For cross-dataset foreign-key references, prefer
[`relate`](../recipes.md#cross-dataset-foreign-keys) (a derived
helper).

Source:
[`src/foundation/types.ts`](../../src/foundation/types.ts) and
[`src/foundation/axes.ts`](../../src/foundation/axes.ts).

### `.invariant`

```ts
import { int } from '@databehave/schema'

const evenScore = int()
  .min(0).max(100)
  .invariant(v => (v as number) % 2 === 0)
```

`Schema<T>.invariant(fn: InvariantFn): this` where
`InvariantFn = (value: unknown, ctx: GenContext) => boolean`. Applies
to any schema. The generator rejection-samples up to `MAX_ATTEMPTS`
(= 100, see `src/generator/engine.ts`) — exhaustion throws
`SchemaConflictError`. Multiple `.invariant(...)` calls stack; all must
hold.

Source:
[`src/foundation/types.ts`](../../src/foundation/types.ts).

### `.in`

```ts
import { str, int, obj } from '@databehave/schema'

const grade = str().in(['A', 'B', 'C'])
const odd   = int().in([1, 3, 5, 7])

const Item = obj({
  group: str().in(['A', 'B']),
  type:  str().in({
    kind:      'lookup',
    fromField: 'group',
    map: {
      A: ['T1', 'T2'],
      B: ['X', 'Y'],
    },
  }),
})
```

`Schema<T>.in(constraint: DomainConstraint | readonly unknown[]):
this`. The array form is sugar for `{ kind: 'values', values }`. The
lookup form picks from `map[parent[fromField]]`; `fromField` must be a
sibling key on the enclosing `obj({...})`. Domain constraints apply to
both generation and validation — `parse(...)` rejects values outside
the candidate set.

Source:
[`src/foundation/types.ts`](../../src/foundation/types.ts).

### `.correlate`

```ts
import { obj, int } from '@databehave/schema'

const Range = obj({
  start: int().min(0).max(100),
  end:   int().min(0).max(100),
}).correlate(r => r.start <= r.end)   // r: { start: number; end: number }
```

`ObjectSchema<F>.correlate(fn: (row: InferObject<F>) => boolean):
this` — typed multi-field invariant. Equivalent to `.invariant`, but
the callback is typed against the inferred object shape so cross-field
predicates type-check. Implemented as an
[`.invariant`](#invariant) under the hood (rejection-sampled up to
`MAX_ATTEMPTS = 100`). `ObjectSchema` only.

Source:
[`src/schema/composites.ts`](../../src/schema/composites.ts).

---

## Axis priority

When more than one axis is attached to the same node, the generator
evaluates them in this order (high → low):

1. **invariants** — single-record predicates that must hold.
2. **identity** — dataset-level (handled by the dataset engine; see
   [`../dataset/index.md`](../dataset/index.md)).
3. **derived** — computed via `.derivedFrom(fn)`; skips sampling.
4. **conditional shape** — `union` / `discriminated` branch selection.
5. **domain** — closed candidate set from `.in(...)`.
6. **distribution** — `.weighted` / `.normal` / `.typically`.
7. **type defaults** — kind-specific fallback (e.g. uniform within
   `[min, max]`).

Cadence overrides (`.occasionally` / `.eventually`) layer above the
distribution stage: `eventually` is evaluated first, then
`occasionally`, then the base distribution feeds in. The canonical
restatement of this priority lives in
[`../design.md#4-axis-priority`](../design.md#4-axis-priority).

Source:
[`src/foundation/axes.ts`](../../src/foundation/axes.ts) and
[`src/generator/engine.ts`](../../src/generator/engine.ts) (the
generator restates the order in its file header).
