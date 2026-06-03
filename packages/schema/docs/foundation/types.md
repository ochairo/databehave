# Foundation types — reference

Public callable types, axis-override runtime shapes, the closed-set
domain constraint, and the error hierarchy. These are the foundation
types reachable from
[`@databehave/schema`](../../src/index.ts) that are *not* part of
the schema DSL surface or the generator/validator entry points.

Source:
[`src/foundation/axes.ts`](../../src/foundation/axes.ts),
[`src/foundation/errors.ts`](../../src/foundation/errors.ts).

---

## `DerivedFn`

```ts
type DerivedFn = (ctx: GenContext) => unknown
```

A pure function that computes a field's value from the surrounding
[`GenContext`](../generator/sampling.md#gencontext). Used as the
argument to
[`.derivedFrom(fn)`](../schema/bound-operators.md#derivedfrom) and
as the return type of
[`relate(rows, field, opts?)`](../dataset/relate.md#relate).

```ts
import { obj, int, decimal } from '@databehave/schema'

const LineItem = obj({
  qty:   int().min(1).max(10),
  price: decimal(10, 2).min('100').max('5000'),
  total: decimal(12, 2).derivedFrom(ctx =>
    String(Number(ctx.parent.qty as number) * Number(ctx.parent.price as string)),
  ),
})
```

`DerivedFn` callbacks must be deterministic — no `Math.random()`, no
`Date.now()`. The generator skips sampling for derived fields and the
validator re-runs the function to verify equality (see
[validator behaviour](../validator/index.md#what-the-validator-checks)).

Source:
[`src/foundation/axes.ts`](../../src/foundation/axes.ts) (`DerivedFn`
type).

## `InvariantFn`

```ts
type InvariantFn = (value: unknown, ctx: GenContext) => boolean
```

A single-record predicate. Returns `true` when `value` is
acceptable. Used as the argument to
[`.invariant(fn)`](../schema/bound-operators.md#invariant) (per-leaf
predicate) and, with a stronger inferred type, as the argument to
[`ObjectSchema.correlate(fn)`](../schema/bound-operators.md#correlate)
(multi-field predicate).

```ts
import { int } from '@databehave/schema'

const evenPositive = int().min(2).max(100).invariant(v => (v as number) % 2 === 0)
```

The generator rejection-samples up to
[`MAX_ATTEMPTS = 100`](../generator/sampling.md#rejection-sampling)
times for a single record before throwing
[`SchemaConflictError`](#schemaconflicterror).

Source:
[`src/foundation/axes.ts`](../../src/foundation/axes.ts)
(`InvariantFn` type).

## `OccasionalOverride`

```ts
type OccasionalOverride = {
  readonly value: unknown
  readonly p:     number   // ∈ [0, 1]
}
```

The runtime shape stored on a schema's
[`Modifiers.axes.occasionally`](../extending.md) array, populated by
[`.occasionally(value, p)`](../schema/bound-operators.md#occasionally).
Each entry in the list is evaluated independently; the first one
that fires (with probability `p`) wins. Stacks **before** the base
distribution.

```ts
import { str } from '@databehave/schema'

const status = str().in(['ok', 'warn']).occasionally('error', 0.005)
// At sample time: P('error') = 0.005, then base distribution otherwise.
```

`p` outside `[0, 1]` throws `RangeError` at build time — see
[`.occasionally`](../schema/bound-operators.md#occasionally).

Source:
[`src/foundation/axes.ts`](../../src/foundation/axes.ts)
(`OccasionalOverride` type).

## `EventuallyOverride`

```ts
type EventuallyOverride = {
  readonly value:   unknown
  readonly every:   number   // positive integer
  readonly offset?: number
}
```

The runtime shape stored on
[`Modifiers.axes.eventually`](../extending.md), populated by
[`.eventually(every, value, opts?)`](../schema/bound-operators.md#eventually).
At sample time the override fires when
`((ctx.index ?? 0) - (offset ?? 0)) % every === 0` — deterministic,
not probabilistic. Skipped entirely when `ctx.index` is `undefined`
(non-array, non-dataset usage).

```ts
import { int } from '@databehave/schema'

const days = int().min(0).max(365).eventually(7, 0)
// every 7th row reads 0, deterministically driven by ctx.index.
```

`every` must be a positive integer — `RangeError` otherwise. See
[`.eventually`](../schema/bound-operators.md#eventually) for the
build-time check.

Source:
[`src/foundation/axes.ts`](../../src/foundation/axes.ts)
(`EventuallyOverride` type).

## `DomainConstraint`

```ts
type DomainConstraint =
  | { readonly kind: 'values'; readonly values: readonly unknown[] }
  | { readonly kind: 'lookup'; readonly fromField: string;
      readonly map: Readonly<Record<string, readonly unknown[]>> }
```

A closed candidate set the value must belong to. Two kinds:

- **`'values'`** — a literal array of allowed values. The
  fluent helper
  [`.in([a, b, c])`](../schema/bound-operators.md#in) wraps a bare
  array as `{ kind: 'values', values: [...] }`.
- **`'lookup'`** — the candidate set is selected at sample/parse
  time by reading a sibling field. `fromField` names the sibling
  key on the immediate parent object; `map[siblingValue]` is the
  permitted set.

```ts
import { obj, str } from '@databehave/schema'

const Item = obj({
  group: str().in(['A', 'B', 'C']),
  code:  str().in({
    kind:      'lookup',
    fromField: 'group',
    map: {
      A: ['T1', 'T2', 'T3'],
      B: ['X', 'Y'],
      C: ['P', 'Q', 'R', 'S'],
    },
  }),
})
```

`DomainConstraint` is enforced by both the generator (samples are
drawn from the allowed set) and the validator (out-of-set values
fail [`parse`](../validator/api.md#parse)). Distribution axes
(`weighted` / `normal` / `typical`) re-weight *within* the
intersection of the schema's type and the active domain.

Source:
[`src/foundation/axes.ts`](../../src/foundation/axes.ts)
(`DomainConstraint` type).

## `ModifierProbs`

The per-call short-circuit probabilities that govern when
[`.default`](../schema/modifiers.md#default),
[`.optional`](../schema/modifiers.md#optional), and
[`.nullable`](../schema/modifiers.md#nullable) emit their respective
values during sampling. Defined and documented at the generator
boundary because it is supplied through `MockOptions`:

→ [`generator/sampling.md#mockoptionsmodifierprobs`](../generator/sampling.md#mockoptionsmodifierprobs).

The signature, defaults, and `RangeError` semantics are *not* duplicated
here.

## Error hierarchy

```
Error
  └── DataBehaveError (abstract)
        ├── ConformError       (runtime input did not conform)
        └── SchemaConflictError (schema is unsatisfiable / misused)
```

All errors thrown by databehave itself extend `DataBehaveError`.
Callbacks supplied by the user (e.g. inside
[`.derivedFrom`](../schema/bound-operators.md#derivedfrom) or
[`.invariant`](../schema/bound-operators.md#invariant)) that throw
arbitrary `Error`s are *not* wrapped — they surface as the original
error class. Catch `DataBehaveError` to filter library-originated
failures from generic errors.

Source:
[`src/foundation/errors.ts`](../../src/foundation/errors.ts).

### `DataBehaveError`

```ts
abstract class DataBehaveError extends Error {
  abstract readonly path: readonly (string | number)[]
  abstract readonly hint?: string
}
```

Abstract root of the error hierarchy. Every subclass carries a
`path` (JSON-pointer-style location of the failure) and an optional
`hint` (recovery suggestion, also baked into the error message
prefix).

```ts
import { DataBehaveError, parse, str } from '@databehave/schema'

try {
  parse(str().min(3), 'no')
} catch (e) {
  if (e instanceof DataBehaveError) {
    console.error('databehave failure at', e.path.join('.'))
  }
  throw e
}
```

### `ConformError`

```ts
class ConformError extends DataBehaveError {
  readonly issues: readonly Issue[]
  readonly path: readonly (string | number)[]   // always [] (issues carry their own paths)
  readonly hint?: string
}
```

Thrown by [`parse(schema, value)`](../validator/api.md#parse) when
the value does not conform. Each individual failure is captured in
an [`Issue`](#issue) on `issues`; `path` on the error itself is
always the empty root pointer because per-issue paths are richer.

Use [`safeParse`](../validator/api.md#safeparse) to receive a
discriminated result instead of an exception.

```ts
import { ConformError, parse, obj, int } from '@databehave/schema'

try {
  parse(obj({ x: int().min(1) }), { x: 0 })
} catch (e) {
  if (e instanceof ConformError) {
    for (const i of e.issues) console.error(i.path, i.message)
  }
  throw e
}
```

### `SchemaConflictError`

```ts
class SchemaConflictError extends DataBehaveError {
  readonly path: readonly (string | number)[]
  readonly hint?: string
}
```

Thrown in two situations:

1. **Build time** — a modifier does not apply to the schema kind
   (e.g. `obj({...}).weighted([...])`). The capability matrix is
   the canonical reference;
   see [`stability.md#fail-loud-policy`](../stability.md#fail-loud-policy).
2. **Runtime** — an axis combination is unsatisfiable (e.g.
   `int().min(10).max(5)`, an invariant rejects every sample for
   [`MAX_ATTEMPTS`](../generator/sampling.md#rejection-sampling)
   in a row, a derived value lands outside its declared domain, or
   a [`mockDataset` collision retry budget](../dataset/mock-dataset.md#collisions)
   is exhausted).

```ts
import { SchemaConflictError, mock, int } from '@databehave/schema'

try {
  mock(int().min(10).max(5))
} catch (e) {
  if (e instanceof SchemaConflictError) {
    console.error(e.message, '(hint:', e.hint, ')')
  }
  throw e
}
```

### `Issue`

```ts
type Issue = {
  readonly path:      readonly (string | number)[]
  readonly code:      IssueCode
  readonly message:   string
  readonly expected?: string
  readonly received?: unknown
}
```

A single per-field failure inside a
[`ConformError`](#conformerror). `path` is JSON-pointer-style
(string keys for object fields, numeric indices for arrays).
`code` is a stable, machine-matchable identifier drawn from the
closed [`IssueCode`](../../src/foundation/errors.ts) catalog — use
it (together with `path`) for programmatic assertions and runtime
branching. `expected` is a human-readable description of the rule
that failed. `received` carries the offending value when it is safe
to echo (the validator omits it for axis violations whose payload
is already implied by `expected`).

> **`Issue.message` is diagnostic-only.** Message wording is **not**
> part of the SemVer contract and may change in any release. See
> [`stability.md`](../stability.md#issue-messages-are-diagnostic-only).
> Match on `code` + `path` instead.

Source:
[`src/foundation/errors.ts`](../../src/foundation/errors.ts) (`Issue`
type).
