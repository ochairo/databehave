# Recipes

Practical patterns for common modelling problems. Each example is
self-contained and runnable against the public surface.

## Realistic numeric distributions

Bounds tell you what is legal; `.typically(...)` tells you what is
usual; `.occasionally` / `.eventually` insert the outliers tests need
to see.

```ts
import { decimal } from '@databehave/schema'

const quantity = decimal(38, 19)
  .min('0').max('100000')
  .typically(60_000, 80_000)        // bell of normal operation
  .occasionally('0', 0.005)          // 0.5 % rare zeros
  .eventually('0', 30)               // every 30 days, scheduled reset
```

## Lookup-driven domains

When the legal value set depends on a sibling field:

```ts
import { obj, str } from '@databehave/schema'

const Item = obj({
  group: str().in(['A', 'B', 'C']),
  code: str().in({
    kind: 'lookup',
    fromField: 'group',
    map: {
      A: ['T1', 'T2', 'T3'],
      B: ['X', 'Y'],
      C: ['P', 'Q', 'R', 'S'],
    },
  }),
})
```

Same rule fires in `parse(Item, value)` — the validator rejects
`{ group: 'A', code: 'X' }`.

## Derived fields (single-row)

Computed values that must be a pure function of siblings:

```ts
import { obj, int, decimal } from '@databehave/schema'

const LineItem = obj({
  qty:    int().min(1).max(10),
  price:  decimal(10, 2).min('100').max('5000'),
  total:  decimal(12, 2).derivedFrom(ctx =>
    String(
      Number(ctx.parent.qty as number) *
      Number(ctx.parent.price as string),
    ),
  ),
})
```

`total` is regenerated for every row but is always *consistent* with
`qty * price`. The validator does **not** re-check the derivation —
derived fields are trusted output.

## Multi-field invariants (`correlate`)

Type-safe predicates over the whole object:

```ts
import { obj, int } from '@databehave/schema'

const DateRange = obj({
  start: int().min(0).max(365),
  end:   int().min(0).max(365),
}).correlate(r => r.start <= r.end)
```

The generator rejection-samples up to 100 attempts. If your predicate is
narrow (e.g. `r.start === r.end + 1`), give it more breathing room by
widening the underlying ranges or by computing one field with
`derivedFrom`.

## Discriminated unions

Conditional shape switched by a literal key field:

```ts
import { discriminated, obj, literal, decimal, str } from '@databehave/schema'

const Variant = discriminated('kind', {
  alpha: obj({
    kind:   literal('alpha'),
    score:  decimal(8, 2).min('0').max('5000'),
  }),
  beta: obj({
    kind:   literal('beta'),
    weight: decimal(6, 2).min('-50').max('500'),
  }),
  gamma: obj({
    kind:   literal('gamma'),
    units:  str().in(['u1', 'u2']),
    rate:   decimal(10, 3),
  }),
})

type Variant = Infer<typeof Variant>
// { kind: 'alpha';   score:  string }
// | { kind: 'beta';  weight: string }
// | { kind: 'gamma'; units: 'u1' | 'u2'; rate: string }
```

## Datasets and identity

Generate `n` rows with unique identity keys. Repeating the same options reproduces the dataset under the
[determinism contract](stability.md#determinism-contract); identity keys do not create a shared row cache:

```ts
import { mockDataset, obj, str, int } from '@databehave/schema'

const CatalogRow = obj({
  group_code: str(),
  item:      int().min(1).max(7),
  date:      str(),     // ISO date
  quantity:  int(),
})

const rows = mockDataset({
  name:     'Catalog',
  schema:   CatalogRow,
  identity: ['group_code', 'item', 'date'],
  n:        100,
})

// Repeating the same options reproduces the dataset:
const lookup = mockDataset({
  name:     'Catalog',
  schema:   CatalogRow,
  identity: ['group_code', 'item', 'date'],
  n:        100,
})
// lookup deep-equals rows. For a specific identity, query the generated rows.
```

## Cross-dataset foreign keys

`relate(rows, field)` returns a `DerivedFn` that picks a value from a
previously-generated dataset:

```ts
import { mockDataset, obj, str, int, arr, mock, relate } from '@databehave/schema'

const groups = mockDataset({
  name:     'groups',
  schema:   obj({ group_code: str(), name: str() }),
  identity: ['group_code'],
  n:        5,
})

const Item = obj({
  item_id:    int().min(1).max(7),
  group_code: str().derivedFrom(relate(groups, 'group_code')),       // FK
  // pickBy: 'random' (default), 'index', or (ctx) => number
})

mock(arr(Item).length(20), { seed: 'demo' })
```

For per-row deterministic assignment (instead of random sampling):

```ts
group_code: str().derivedFrom(relate(groups, 'group_code', { pickBy: 'index' }))
```

## Deterministic snapshot tests

`replay` binds (seed, input); `expectStable` asserts determinism:

```ts
import { replay, expectStable, obj, int } from '@databehave/schema'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const S = obj({ x: int().min(0).max(100) })

test('snapshot is stable', () => {
  const gen = replay(S, { seed: 'fix-1' })
  assert.deepEqual(gen(), gen())
})

test('no hidden non-determinism', () => {
  expectStable(S, { seed: 'fix-1' })   // throws if Date.now / Math.random sneak in
})
```

## Per-request HTTP seeding

Make every HTTP response a pure function of the request:

```ts
import { createHash } from 'node:crypto'
import { mock } from '@databehave/schema'

const seedFor = (req: { method: string; path: string; query: object }): string =>
  createHash('sha256')
    .update(`${req.method}|${req.path}|${JSON.stringify(req.query)}`)
    .digest('hex')
    .slice(0, 16)

app.get('/items', (req, reply) => {
  reply.send(mock(Response, { seed: seedFor(req) }))
})
```

Identical requests return identical responses across machines, restarts,
and CI runs.

## Debugging with `createTrace()`

```ts
import { mock, createTrace } from '@databehave/schema'

const trace = createTrace()
mock(Schema, { seed: 'demo', trace })

console.log(trace.format())
// /                       type
// /quantity               distribution    (typical)
// /group_code             derived
// /flag                   occasionally    (note: rolled 0.003)
```

Use `trace.axisFiredAt('invariant-fail')` to find paths where
rejection-sampling thrashed.

## Aggregate dataset invariants

```ts
mockDataset({
  name:    'Daily',
  schema:  Row,
  identity: ['date'],
  n:       30,
  invariants: [
    rows => rows.reduce((s, r) => s + Number(r.value), 0) > 50_000, // sum bound
    rows => new Set(rows.map(r => r.date)).size === rows.length,  // unique date
  ],
})
```

Keep aggregates loose — invariants narrow the acceptable output space
multiplicatively, and dataset generation uses a single retry budget.

## OpenAPI interop (without a CLI)

The standalone schema runtime has no OpenAPI dependency. The separate
[`@databehave/openapi`](../../openapi/README.md) package owns the official adapter and operation catalog.

### databehave → OpenAPI (codegen)

There is no complete built-in schema-to-OpenAPI exporter. An application-owned adapter must define mappings for
every supported kind/behavior and reject unsupported semantics. Use the selected runtime's traversal API to inspect
nodes; callback paths are arrays of string/number segments, not visitor-context objects:

```ts
import { standardRuntime, obj, int } from '@databehave/schema'

const User = obj({ id: int().min(1) })
standardRuntime.walkSchema(User, {
  enter(node, path) { console.log(path, node.kind) },
})
```

Standard kind IDs include `number` (with `int: true` for integers), `string`, `array` and `object`; builder function
names are not kind IDs. `SchemaNode` is open, so a standard-only converter must validate/narrow metadata and fail on
custom kinds it cannot represent. See [schema extensions](extending.md) for reconstruction and contract checks.

### OpenAPI → databehave (ingestion)

Use `schemaGeneratorPlugin` from `@databehave/openapi/schema` with explicit builders and a schema runtime.
It compiles response schemas during host preparation and rejects unsupported schemas in strict mode. The
[OpenAPI guide](../../openapi/README.md) documents supported shapes, seeding, provider selection and the separate
request-validation contract. Load JSON text in application configuration; convert YAML explicitly if needed.

### Why this lives outside core

- Schema-only applications need no HTTP or OpenAPI dependencies.
- Applications explicitly choose placeholder, schema-backed or external response providers.
- The OpenAPI package owns translation policy; schema descriptors own generation and validation semantics.
