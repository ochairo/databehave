# Universal modifiers

Four methods every `Schema<T>` carries — independent of the underlying
kind. Each returns a fresh schema whose IR has the modifier flag set
under `_node.mods`; all four survive `fromIR` round-trips.

These narrow / annotate the value but do not bind a sampling strategy;
for the kind-specific population operators see
[bound-operators.md](./bound-operators.md).

## `.nullable`

```ts
import { str } from '@databehave/schema'

const optionalNote = str().nullable()
type Note = Infer<typeof optionalNote>  // string | null
```

`Schema<T>.nullable(): Schema<T | null>` — sets `mods.nullable = true`.
The generator may emit `null`; the validator accepts `null`. Pairs
naturally with [`.optional`](#optional) when you need both
"absent or null".

Source:
[`src/foundation/types.ts`](../../src/foundation/types.ts).

## `.optional`

```ts
import { obj, str } from '@databehave/schema'

const User = obj({
  id:    str(),
  email: str().optional(),
})

type User = Infer<typeof User>          // { id: string; email?: string }
```

`Schema<T>.optional(): Schema<T | undefined>` — sets `mods.optional =
true`. The flag participates in [`obj`](./composites.md#obj) key
inference: every field marked `.optional()` becomes an optional
property (`?:`) on the inferred object type; every other field is
required.

Source:
[`src/foundation/types.ts`](../../src/foundation/types.ts).

## `.default`

```ts
import { int } from '@databehave/schema'

const retries = int().default(3)
```

`Schema<T>.default(value: T): Schema<T>` — sets
`mods.hasDefault = true` and `mods.defaultValue = value`. The generator
may short-circuit to `value` instead of sampling; the exact probability
is a generator concern (see
[`../generator/sampling.md#mockoptionsmodifierprobs`](../generator/sampling.md#mockoptionsmodifierprobs)
for the `MockOptions.modifierProbs` knob — out of scope for this slice). The
validator does not inject the default — `parse(undefined)` still
fails — `default` is a generator hint, not a coercion.

Source:
[`src/foundation/types.ts`](../../src/foundation/types.ts).

## `.describe`

```ts
import { str } from '@databehave/schema'

const groupCode = str().describe('Two-letter group code (e.g. "AB").')
```

`Schema<T>.describe(text: string): this` — sets `mods.description`. The
modifier is preserved through every other operator (the return type is
`this`, not a new `Schema`), so the description survives downstream
chains.

The string is free-form metadata. Plugins (OpenAPI ingestion, JSON
Schema export) read it through
[`walkSchema`](../extending.md#walkschemanode-visitor--read-only-traversal)
to populate their own `description` field.

Source:
[`src/foundation/types.ts`](../../src/foundation/types.ts).
