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

Generate `n` rows that share a schema and identity keys; same tuple
always returns the same row:

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

// Calling again with the same identity tuple → identical row:
const lookup = mockDataset({
  name:     'Catalog',
  schema:   CatalogRow,
  identity: ['group_code', 'item', 'date'],
  n:        1,
})
// lookup[0] equals rows[i] for some i with matching identity (when seeds match).
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

databehave intentionally ships no OpenAPI ingestion or codegen in the core
package. Both directions are short enough to live in your own repo, or
in a thin sibling package, using `walkSchema` and the builder
functions.

### databehave → OpenAPI (codegen)

Walk the IR and emit an OpenAPI 3.1 fragment. Drop this in a
`scripts/emit-openapi.ts` and run it from a `package.json` script.

```ts
import { walkSchema, type Schema } from '@databehave/schema'

export const toOpenApi = (schema: Schema): unknown => {
  const stack: any[] = []
  walkSchema(schema, {
    enter(node) {
      switch (node.kind) {
        case 'int':
          stack.push({ type: 'integer', minimum: node.min, maximum: node.max })
          break
        case 'str':
          stack.push({ type: 'string', pattern: node.pattern?.source })
          break
        case 'decimal':
          stack.push({ type: 'string', format: `decimal(${node.p},${node.s})` })
          break
        case 'arr':
          stack.push({ type: 'array', items: undefined })
          break
        case 'obj':
          stack.push({ type: 'object', properties: {}, required: [] as string[] })
          break
        case 'literal':
          stack.push({ const: node.value })
          break
        case 'discriminated':
          stack.push({ oneOf: [] as unknown[], discriminator: { propertyName: node.tag } })
          break
        default:
          stack.push({})
      }
    },
    leave(_node, ctx) {
      const built  = stack.pop()
      const parent = stack[stack.length - 1]
      if (!parent) { stack.push(built); return }
      if (parent.type === 'object') {
        parent.properties[ctx.key!] = built
        parent.required.push(ctx.key!)
      } else if (parent.type === 'array') {
        parent.items = built
      } else if (Array.isArray(parent.oneOf)) {
        parent.oneOf.push(built)
      }
    },
  })
  return stack[0]
}
```

Usage:

```ts
import { writeFileSync } from 'node:fs'
import { User, Order } from '../src/api/schemas.js'
import { toOpenApi } from './to-openapi.js'

const doc = {
  openapi: '3.1.0',
  info: { title: 'My API', version: '1.0.0' },
  components: {
    schemas: {
      User:  toOpenApi(User),
      Order: toOpenApi(Order),
    },
  },
}

writeFileSync('openapi.json', JSON.stringify(doc, null, 2))
```

### OpenAPI → databehave (ingestion)

The opposite direction calls databehave's builders directly. Use this in a
test setup file or msw handler, not at runtime in production.

```ts
import { obj, str, int, decimal, arr, literal, type Schema } from '@databehave/schema'

export const fromOpenApi = (node: any): Schema => {
  if (node.const !== undefined) return literal(node.const)
  if (node.type === 'object') {
    const fields: Record<string, Schema> = {}
    for (const [k, v] of Object.entries(node.properties ?? {})) {
      fields[k] = fromOpenApi(v)
    }
    return obj(fields)
  }
  if (node.type === 'array')   return arr(fromOpenApi(node.items))
  if (node.type === 'integer') {
    return int().min(node.minimum ?? 0).max(node.maximum ?? 2 ** 31 - 1)
  }
  if (node.type === 'string') {
    if (node.format?.startsWith('decimal(')) {
      const [p, s] = node.format.slice(8, -1).split(',').map(Number)
      return decimal(p, s)
    }
    return node.pattern ? str().pattern(new RegExp(node.pattern)) : str()
  }
  throw new Error(`unsupported openapi node: ${JSON.stringify(node)}`)
}
```

Usage in a test:

```ts
import openapi from './openapi.json' with { type: 'json' }
import { fromOpenApi } from './from-openapi.js'
import { mock } from '@databehave/schema'

const UserSchema = fromOpenApi(openapi.components.schemas.User)
const fixture    = mock(UserSchema, { seed: 'user-1' })
```

### Why this lives outside core

- The core stays zero-dep. OpenAPI ingestion needs a YAML parser (if
  you accept `.yaml`) or just a JSON import, but the adapter itself is
  the user's choice.
- Different teams want different mappings (`format: decimal(10,2)` vs
  `x-databehave-decimal: [10, 2]`, `nullable: true` vs `oneOf`, etc.).
  Hard-coding one mapping into core forces a contract on everyone.
- A future `databehave-openapi` package can iterate on these mappings
  independently from the core release cycle.
