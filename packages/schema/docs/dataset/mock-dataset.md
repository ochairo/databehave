# `mockDataset` — generate identity-bound row sets

```ts
import { mockDataset, obj, str, int } from '@databehave/schema'

const Catalog = obj({
  group_code: str(),
  item:       int().min(1).max(7),
  date:       str(),
  quantity:   int().min(0).max(1_000),
})

const rows = mockDataset({
  name:     'Catalog',
  schema:   Catalog,
  identity: ['group_code', 'item', 'date'],
  n:        100,
})
//   ^ Infer<typeof Catalog>[]
```

`mockDataset(opts)` returns `n` rows whose identity tuples are
guaranteed unique and whose aggregate invariants (if any) all hold.
The result is `Infer<S>[]` where `S` is the per-record schema.

Source:
[`src/dataset/dataset.ts`](../../src/dataset/dataset.ts).

---

## `mockDataset(opts)`

Signature:

```ts
const mockDataset: <S extends Schema>(opts: DatasetOptions<S>) => Infer<S>[]
```

Each row is sampled by [`mock(opts.schema, ...)`](../generator/sampling.md#mock)
with a per-row seed derived from `opts.seedPrefix ?? opts.name`, the
row index, and an internal attempt/dedup counter. After every row the
identity tuple is computed via
[`identityFor(opts.name, opts.identity, row)`](./identity.md#identityfor);
collisions trigger a re-roll (see [Collisions](#collisions)).

When all aggregate invariants pass and no identity collision survives
the dedup loop, the row list is returned. Otherwise the dataset
re-runs with a new seed family up to
`MAX_DATASET_RETRIES + 1 = 2` total attempts before throwing.

## `DatasetOptions<S>`

```ts
type DatasetOptions<S extends Schema> = {
  readonly name:        string
  readonly schema:      S
  readonly identity:    readonly string[]
  readonly n:           number
  readonly invariants?: readonly ((rows: readonly Infer<S>[]) => boolean)[]
  readonly input?:      Readonly<Record<string, unknown>>
  readonly seedPrefix?: string
}
```

| Field | Required | Purpose |
| --- | --- | --- |
| `name` | yes | Unique dataset name. Participates in the per-row seed and in the identity key prefix. Two datasets with the same `name` and identical identity values produce the same key. |
| `schema` | yes | Per-record [`Schema`](../schema/index.md). The result type is `Infer<S>[]`. |
| `identity` | yes | Field names whose tuple defines a record's identity. Order is irrelevant for the identity key (sorted internally) but the array is read verbatim — names must be exact. |
| `n` | yes | Number of records to produce. The identity domain must be ≥ `n`, otherwise the dataset throws (see [Collisions](#collisions)). |
| `invariants` | no | Aggregate predicates `(rows) => boolean` over the **full** row list. Failing predicates trigger a dataset-level re-roll (one retry). |
| `input` | no | Caller-supplied free-form bag forwarded as `ctx.input` to every `mock()` call (see [`MockOptions.input`](../generator/sampling.md#mockoptionsinput--caller-supplied-context)). |
| `seedPrefix` | no | Override the seed prefix; defaults to `name`. Useful when two datasets share an identity scheme but must diverge sample-wise. |

```ts
import { mockDataset, obj, str } from '@databehave/schema'

// `input` reaches every derived/invariant callback through ctx.input.
const Stamped = obj({
  id: str(),
  asOf: str().derivedFrom(c => (c.input as { now?: string })?.now ?? '1970-01-01'),
})

const rows = mockDataset({
  name:       'stamped',
  schema:     Stamped,
  identity:   ['id'],
  n:          10,
  input:      { now: '2026-05-22' },
  seedPrefix: 'tenant-A',                   // diverge from a 'tenant-B' twin
  invariants: [list => list.length === 10], // aggregate guard
})
```

## Collisions

Identity uniqueness is enforced at row write time. The retry budget is:

```
DEDUP_ATTEMPTS_PER_ROW = 8
MAX_DATASET_RETRIES    = 1   (so 2 total dataset attempts)
```

For each row, up to **8** dedup attempts re-sample the row with a
fresh sub-seed. If all 8 collide, the dataset abandons the run and
restarts from row 0 with a new attempt counter — at most **once**.
If both attempts still fail to fill `n` unique identities, or no
attempt satisfies the aggregate invariants, the dataset throws.

```ts
mockDataset({
  name:     'tiny',
  schema:   obj({ tag: str().in(['A', 'B']) }),
  identity: ['tag'],
  n:        10,                       // domain has 2 values, asks for 10
})
//   ↑ throws SchemaConflictError:
//     dataset "tiny": could not satisfy identity uniqueness or aggregate
//     invariants after 2 dataset attempt(s) × 8 dedup retries
//     (hint: widen the identity domain, lower n, or relax aggregate invariants)
```

Raise `n`'s domain, narrow `n`, or relax invariants to recover.

## Errors

`mockDataset` throws exactly one error class:

- [`SchemaConflictError`](../foundation/types.md#schemaconflicterror)
  — when the retry budget is exhausted (identity collisions or
  aggregate-invariant rejection). The thrown error carries
  `path: [opts.name]` and a recovery hint. See
  [Collisions](#collisions) for the budget.

Per-record sampling errors raised by
[`mock()`](../generator/sampling.md#mock) (e.g. an unsatisfiable
single-record `.invariant`, `int().min(10).max(5)`) propagate
unchanged — they are not wrapped.

Validation never runs inside `mockDataset`; pair it with
[`parse`](../validator/api.md#parse) at your boundary if the dataset
also needs to round-trip caller input.

## Cross-references

- [`relate(rows, field, opts?)`](./relate.md#relate) — feed a
  generated dataset back into another schema as a foreign key.
- [`identityFor(name, identity, row)`](./identity.md#identityfor) —
  the identity-key function `mockDataset` uses internally; exported
  for cross-dataset lookups.
- Recipe: [Cross-dataset foreign keys](../recipes.md#cross-dataset-foreign-keys).
- Recipe: [Datasets and identity](../recipes.md#datasets-and-identity).
