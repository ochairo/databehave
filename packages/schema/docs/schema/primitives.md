# Primitives

Scalar type builders. Each returns a `Schema<T>` whose phantom `_type`
parameter feeds [`Infer<S>`](../extending.md). All primitives accept the
[universal modifiers](./modifiers.md) and may be wrapped by a
[composite](./composites.md).

## `str`

```ts
import { str } from '@databehave/schema'

const code = str()                    // Schema<string>
```

`str(): StringSchema` — produces unbounded UTF-8 strings (kind
`'string'`, format `'plain'`). For length and pattern constraints see
[bound-operators.md → String bounds](./bound-operators.md#string-bounds)
and [String `.pattern`](./bound-operators.md#string-pattern).

Source: [`src/schema/primitives.ts`](../../src/schema/primitives.ts).

## `num`

```ts
import { num } from '@databehave/schema'

const ratio = num()                   // Schema<number>, continuous
```

`num(): NumberSchema` — unbounded continuous IEEE-754 number (kind
`'number'`, `int: false`). For range bounds, distributions, and the
integer variant, see
[bound-operators.md → Number bounds](./bound-operators.md#number-bounds).

Source: [`src/schema/primitives.ts`](../../src/schema/primitives.ts).

## `int`

```ts
import { int } from '@databehave/schema'

const qty = int().min(0).max(100)     // Schema<number>, integers
```

`int(): NumberSchema` — same return type as `num()`, but the IR carries
`int: true`, so the generator rounds to whole values. Inferred type is
still `number` (TypeScript has no integer type).

Source: [`src/schema/primitives.ts`](../../src/schema/primitives.ts).

## `decimal`

```ts
import { decimal } from '@databehave/schema'

const amount = decimal(38, 19)        // Schema<string>
  .min('0')
  .max('100000')
```

`decimal(precision: number, scale: number): DecimalSchema` — fixed-point
numeric represented as a **string** to preserve precision through
JavaScript / JSON boundaries. Targets Snowflake / Postgres
`NUMERIC(precision, scale)`. The inferred type is `string`.

Validation rules at build time (both throw `RangeError`):

- `precision` must be an integer in `[1, 38]`.
- `scale` must be an integer in `[0, precision]`.

```ts
decimal(40, 4)   // RangeError: precision must be integer in [1, 38], got 40
decimal(10, 11)  // RangeError: scale must be integer in [0, precision], got 11
```

`.min(value)` and `.max(value)` accept either `string` or `number` and
store the bound as a string — see
[bound-operators.md → Decimal bounds](./bound-operators.md#decimal-bounds).

Source: [`src/schema/decimal.ts`](../../src/schema/decimal.ts).

## `bool`

```ts
import { bool } from '@databehave/schema'

const isActive = bool()               // Schema<boolean>
```

`bool(): Schema<boolean>` — produces `true` / `false`. No kind-specific
operators; the universal modifiers and `.weighted([[true, w], [false,
w]])` apply.

Source: [`src/schema/primitives.ts`](../../src/schema/primitives.ts).

## `null_`

```ts
import { null_ } from '@databehave/schema'

const tombstone = null_()             // Schema<null>
```

`null_(): Schema<null>` — generates and validates only the literal
`null`. The trailing underscore avoids colliding with the JS reserved
word. Use it inside a `union` or with `.nullable()` from
[modifiers.md](./modifiers.md#nullable) to express "value or null".

Source: [`src/schema/primitives.ts`](../../src/schema/primitives.ts).
