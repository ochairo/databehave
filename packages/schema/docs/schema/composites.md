# Composites

Composite builders combine [primitives](./primitives.md) (or other
composites) into objects, arrays, tuples, unions, and discriminated
unions. Each returns a `Schema<T>` whose inferred TypeScript shape is
derived from the inputs via mapped / conditional types.

## `obj`

```ts
import { obj, str, int } from '@databehave/schema'

const User = obj({
  id:    int(),
  name:  str(),
  email: str().optional(),     // → key inferred as optional
})

type User = Infer<typeof User> // { id: number; name: string; email?: string }
```

`obj<F>(fields: F): ObjectSchema<F>` — every field marked
[`.optional()`](./modifiers.md#optional) becomes an optional property
(`?:`) on the inferred type; every other field is required.

Field-name guard. The names `__proto__`, `prototype`, and `constructor`
are rejected at build time with `RangeError` to prevent
prototype-pollution patterns from leaking into generated objects:

```ts
obj({ __proto__: str() })
// RangeError: obj(): field name "__proto__" is forbidden ...
```

Multi-field invariants attach via
[`.correlate(fn)`](./bound-operators.md#correlate); single-record
predicates via [`.invariant(fn)`](./bound-operators.md#invariant).
The capability matrix forbids `.weighted` / `.normal` / `.typically`
on `obj` — see [Capability matrix](./bound-operators.md#capability-matrix).

Source: [`src/schema/composites.ts`](../../src/schema/composites.ts).

## `arr`

```ts
import { arr, int } from '@databehave/schema'

const scores = arr(int().min(0).max(100))
  .min(1)
  .max(8)                            // Schema<number[]>
```

`arr<S>(item: S): ArraySchema<S>` — variable-length array of `Infer<S>`.
Bounds (`.length(n)`, `.min(n)`, `.max(n)`) are documented in
[bound-operators.md → Array bounds](./bound-operators.md#array-bounds);
they rebuild the schema while preserving every previously-attached
modifier (axes, `describe`, `optional`, …).

Capability matrix: `.weighted` / `.normal` / `.typically` are rejected
on `arr` — apply them to the element schema instead. See
[Capability matrix](./bound-operators.md#capability-matrix).

Source: [`src/schema/composites.ts`](../../src/schema/composites.ts).

## `tuple`

```ts
import { tuple, str, int } from '@databehave/schema'

const Point = tuple(str(), int(), int())
type Point = Infer<typeof Point>     // [string, number, number]
```

`tuple<T extends readonly Schema[]>(...items: T): TupleSchema<T>` —
fixed-length, fixed-position heterogeneous list. The inferred type is a
positional tuple, not an array.

Capability matrix: `.weighted` / `.normal` / `.typically` are rejected
on `tuple` — apply them to the specific element you want to bias.

Source: [`src/schema/composites.ts`](../../src/schema/composites.ts).

## `union`

```ts
import { union, str, int } from '@databehave/schema'

const StringOrInt = union(str(), int())
type StringOrInt = Infer<typeof StringOrInt>  // string | number
```

`union<T extends readonly Schema[]>(...options: T): UnionSchema<T>` —
non-discriminated union; the generator picks one option uniformly per
call; the validator accepts the value if any option's `parse`
succeeds. Empty unions throw `RangeError` at build.

For tag-driven branching, prefer [`discriminated`](#discriminated) —
it is `O(1)` at validation time and produces clearer errors.
The capability matrix forbids `.weighted` on `union` (the historical
behaviour silently sampled uniformly, which was strictly worse than
failing loud); the redirect hint points callers to `discriminated`.
See [Capability matrix](./bound-operators.md#capability-matrix).

Source: [`src/schema/composites.ts`](../../src/schema/composites.ts).

## `literal`

```ts
import { literal } from '@databehave/schema'

const Yes = literal('yes')           // Schema<'yes'>
type Yes = Infer<typeof Yes>         // 'yes'
```

`literal<V>(value: V): LiteralSchema<V>` where `V extends string |
number | boolean | null`. The generator always produces `value`; the
validator accepts only `value`. Used as the `key:` field in
[`discriminated`](#discriminated) branches.

Source: [`src/schema/composites.ts`](../../src/schema/composites.ts).

## `enum_`

```ts
import { enum_ } from '@databehave/schema'

const Tier = enum_(['gold', 'silver', 'bronze'] as const)
type Tier = Infer<typeof Tier>       // 'gold' | 'silver' | 'bronze'
```

`enum_<V>(values: readonly V[]): EnumSchema<V>` where `V extends string
| number`. Empty value lists throw `RangeError` at build. Unlike a
`union(literal(...), ...)`, an enum is a single discrete-distribution
node and pairs naturally with
[`.weighted([...])`](./bound-operators.md#weighted) to bias which
value is sampled.

The trailing underscore disambiguates from the TypeScript `enum`
keyword.

Source: [`src/schema/composites.ts`](../../src/schema/composites.ts).

## `discriminated`

```ts
import { discriminated, obj, literal, decimal } from '@databehave/schema'

const Variant = discriminated('kind', {
  alpha: obj({ kind: literal('alpha'), score:  decimal(10, 4) }),
  beta:  obj({ kind: literal('beta'),  weight: decimal(10, 4) }),
})

type Variant = Infer<typeof Variant>
// { kind: 'alpha';  score:  string }
// | { kind: 'beta'; weight: string }
```

`discriminated<K, M>(key: K, map: M)` — tag-driven union with `O(1)`
branch dispatch.

Build-time validation (each throws `RangeError`):

1. `map` must contain at least one branch.
2. Every branch must be an `obj({...})` schema.
3. Every branch must declare its `key` field as
   `literal(<map-key>)` exactly.

At generation time the engine samples one branch uniformly per call
and writes the discriminator. At validation time the engine reads
`value[key]` and dispatches to the matching branch; mismatched or
missing tags surface as a `ConformError` keyed on the discriminator
field.

Source: [`src/schema/conditional.ts`](../../src/schema/conditional.ts).
