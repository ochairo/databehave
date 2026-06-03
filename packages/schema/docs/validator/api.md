# Validator API

```ts
import { parse, safeParse, obj, str, int, ConformError } from '@databehave/schema'

const User = obj({ id: int().min(1), name: str().min(2) })

parse(User, { id: 1, name: 'A' })  // throws ConformError: '(root).name: length < min 2'
parse(User, { id: 1, name: 'Alice' })  // → { id: 1, name: 'Alice' } typed Infer<typeof User>

const r = safeParse(User, { id: 0, name: 'Alice' })
if (!r.ok) console.error(r.error.issues)
else       console.log(r.value)
```

Source:
[`src/validator/parse.ts`](../../src/validator/parse.ts).

---

## `parse(schema, value)`

```ts
const parse: <S extends Schema>(schema: S, value: unknown) => Infer<S>
```

Validates `value` against `schema` and returns it typed as
`Infer<typeof schema>` on success. On failure throws
[`ConformError`](#conformerror) carrying every issue collected during
the walk. `parse` never throws `SchemaConflictError` — that error class
is reserved for unsatisfiable schemas at sample time.

For composite kinds, `parse` returns a fresh value: object fields are
copied (so `derivedFrom` keys can be filled in from the validated
sibling values), and array elements are mapped through the recursive
checker.

Source:
[`src/validator/parse.ts`](../../src/validator/parse.ts) (`parse`).

## `safeParse(schema, value)`

```ts
const safeParse: <S extends Schema>(schema: S, value: unknown) => SafeParseResult<Infer<S>>
```

Same as `parse` but returns a discriminated result instead of
throwing. Use this when you want to surface multiple issues to the
caller (HTTP handlers, form validators) without a `try`/`catch`.

Source:
[`src/validator/parse.ts`](../../src/validator/parse.ts) (`safeParse`).

## `SafeParseResult<T>`

```ts
type SafeParseResult<T> =
  | { readonly ok: true;  readonly value: T }
  | { readonly ok: false; readonly error: ConformError }
```

A standard discriminated success/failure pair. The `ok: true` branch
narrows `value` to `Infer<typeof schema>`; the `ok: false` branch
exposes the full `ConformError` (with its
`error.issues: readonly Issue[]` list).

```ts
import { safeParse, str } from '@databehave/schema'

const r = safeParse(str().min(3), 'hi')
if (r.ok) {
  // r.value: string
} else {
  for (const issue of r.error.issues) {
    console.error(issue.path.join('.'), issue.message)
  }
}
```

Source:
[`src/validator/parse.ts`](../../src/validator/parse.ts)
(`SafeParseResult`).

## `ConformError`

```ts
class ConformError extends DataBehaveError {
  readonly issues: readonly Issue[]
  readonly path: readonly (string | number)[]   // always [] — see Issue.path per field
  readonly hint?: string
}

type Issue = {
  readonly path:      readonly (string | number)[]
  readonly message:   string
  readonly expected?: string
  readonly received?: unknown
}
```

`ConformError` is the only error class `parse` / `safeParse` ever
throws or returns. It carries one `Issue` per failed check; each
issue records its own `path` so multi-issue reports stay precise.
The error's `message` is a pre-formatted summary — single-issue or
multi-line — suitable for direct logging.

The class itself is documented under
[`stability.md` → error class hierarchy](../stability.md#error-class-hierarchy);
this page only covers what the validator emits into it. For the full
hierarchy (`DataBehaveError` → `ConformError` /
`SchemaConflictError`) see
[`design.md` §7](../design.md#7-error-model).

Source:
[`src/foundation/errors.ts`](../../src/foundation/errors.ts)
(`ConformError`, `Issue`).

## Worked examples

### Multi-issue object

```ts
import { safeParse, obj, str, int } from '@databehave/schema'

const User = obj({ id: int().min(1), name: str().min(2) })
const r = safeParse(User, { id: 0, name: 'A' })
// r.ok === false
// r.error.issues:
//   [
//     { path: ['id'],   message: '< min 1',          received: 0   },
//     { path: ['name'], message: 'length < min 2',   received: 'A' },
//   ]
```

### Domain (`.in`) and lookup

```ts
import { parse, obj, str } from '@databehave/schema'

const Country = str().in(['JP', 'US', 'DE'] as const)
parse(Country, 'FR')
// throws ConformError: 'value not in domain ["JP", "US", "DE"]'

const Region = str().in({
  kind: 'lookup',
  fromField: 'country',
  map: { JP: ['Tokyo', 'Osaka'], US: ['CA', 'NY'] },
})
const Row = obj({ country: Country, region: Region })
parse(Row, { country: 'JP', region: 'CA' })
// throws ConformError: 'value not in lookup domain for country="JP" ["Tokyo", "Osaka"]'
```

### Discriminated union

```ts
import { parse, discriminated, obj, literal, str } from '@databehave/schema'

const Event = discriminated('kind', {
  click: obj({ kind: literal('click'), x: str() }),
  view:  obj({ kind: literal('view'),  href: str() }),
})

parse(Event, { kind: 'view', href: '/' })       // ok
parse(Event, { kind: 'scroll' })                  // ConformError: unknown discriminator value "scroll"
parse(Event, { kind: 'click', x: 1 as unknown }) // ConformError: '.x: expected string'
```

Source:
[`src/validator/parse.ts`](../../src/validator/parse.ts) (`'object'`,
`'discriminated'`, and domain branches in `check`).
