# `relate` — cross-dataset foreign keys

```ts
import { mockDataset, obj, str, int, arr, mock, relate } from '@databehave/schema'

const Groups = mockDataset({
  name:     'groups',
  schema:   obj({ group_code: str(), name: str() }),
  identity: ['group_code'],
  n:        5,
})

const Item = obj({
  item_id:    int().min(1).max(7),
  group_code: str().derivedFrom(relate(Groups, 'group_code')),  // FK
})

mock(arr(Item).length(20), { seed: 'demo' })
```

`relate(rows, field, opts?)` returns a
[`DerivedFn`](../foundation/types.md#derivedfn) suitable for
[`.derivedFrom(...)`](../schema/bound-operators.md#derivedfrom). At
sample time it picks one row from `rows` and returns its `field`
value. Selection is deterministic — driven by the generator seed —
so re-runs with the same `(seed, input)` produce the same FK
assignments.

Source:
[`src/dataset/relate.ts`](../../src/dataset/relate.ts).

---

## `relate(rows, field, opts?)`

Signature:

```ts
const relate: <R extends Record<string, unknown>, K extends Extract<keyof R, string>>(
  rows: readonly R[],
  field: K,
  opts?: RelateOptions,
) => DerivedFn
```

`rows` must be non-empty — `relate` throws `RangeError` on an empty
array (the resulting `DerivedFn` would have no value to return). The
`field` parameter is constrained at the type level to keys of the
row shape, so typos surface as compile errors rather than silent
`undefined`.

```ts
relate([] as readonly { id: string }[], 'id')
//   ↑ RangeError: relate: empty dataset (cannot pick field "id")
```

The returned `DerivedFn` is pure with respect to its inputs: given
the same `(rows, field, opts)` and the same
[`GenContext`](../generator/sampling.md#gencontext), it returns the
same value. This is the property [`expectStable`](../generator/trace-replay.md#expectstable)
relies on when a schema mixes `relate` with sampled fields.

## `RelateOptions`

```ts
type RelateOptions = {
  readonly pickBy?: 'random' | 'index' | ((ctx: GenContext) => number)
}
```

`pickBy` controls how a row is selected. Three strategies are
supported and behave as follows:

| `pickBy` | Selection rule | When to use |
| --- | --- | --- |
| `'random'` *(default)* | Seeded uniform sample. A sub-RNG is derived from `ctx.seed` plus the field name (`mulberry32(seedFromString(\`${ctx.seed}|relate|${field}\`))`); the sub-RNG draws one index in `[0, rows.length)`. Same seed → same pick. | Default. Use when each row should look like an independent FK draw. |
| `'index'` | `rows[(ctx.index ?? 0) % rows.length]`. | Per-row deterministic assignment when the consumer is itself row-indexed (e.g. inside `mockDataset` or `arr().length(n)` where `index` is set by the generator). Predictable round-robin distribution. |
| `(ctx) => number` | Custom resolver. The returned number is normalised into `[0, rows.length)` via `((n % len) + len) % len`, so negative results are accepted without `Math.abs`. | Lookup by sibling/parent value, conditional FK choice, etc. |

```ts
// Round-robin per row index.
str().derivedFrom(relate(Groups, 'group_code', { pickBy: 'index' }))

// Custom: pick by hashing a sibling field deterministically.
import { seedFromString } from '@databehave/schema/internal'
str().derivedFrom(
  relate(Groups, 'group_code', {
    pickBy: ctx => seedFromString(String((ctx.parent as { tenant?: string }).tenant ?? '')),
  }),
)
```

## Cross-references

- Full recipe (with multi-row example):
  [recipes.md#cross-dataset-foreign-keys](../recipes.md#cross-dataset-foreign-keys).
- The host operator: [`.derivedFrom`](../schema/bound-operators.md#derivedfrom).
- The dataset that produces `rows`: [`mockDataset`](./mock-dataset.md#mockdataset).
- Determinism guarantee around the `'random'` strategy:
  [seed & reproducibility](../generator/seed.md).
