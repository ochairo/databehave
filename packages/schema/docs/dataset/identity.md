# Identity keys

A dataset's *identity* is the tuple of field values that uniquely
names a row. Two rows with the same identity tuple — within one
[`mockDataset`](./mock-dataset.md#mockdataset) call or across separate
calls with the same `name` — must produce the same identity key. This
page documents the helper that turns a row into that key string and
the resolution rules that govern it.

Source:
[`src/dataset/dataset.ts`](../../src/dataset/dataset.ts) (`identityFor`,
`identityKey` from
[`src/foundation/hash.ts`](../../src/foundation/hash.ts)).

---

## `identityFor(name, identity, row)`

```ts
import { identityFor, mockDataset, obj, str, int } from '@databehave/schema'

const Groups = mockDataset({
  name:     'groups',
  schema:   obj({ group_code: str(), region: str() }),
  identity: ['group_code'],
  n:        5,
})

const key = identityFor('groups', ['group_code'], Groups[0]!)
//   ^ string — stable across processes for the same identity values.
```

Signature:

```ts
const identityFor: (
  datasetName: string,
  identityKeys: readonly string[],
  row: Record<string, unknown>,
) => string
```

`identityFor` is the function `mockDataset` calls internally to
detect collisions. It is exported so external code can compute the
same key — for example a cross-dataset cache, a snapshot fixture
keyed by identity, or a custom `relate`-style selector.

The returned string has the shape:

```
DATASET|<datasetName>|<key1>=<json1>&<key2>=<json2>&...
```

Identity-key parts are sorted internally before joining (the order
of `identityKeys` does not affect the result), so callers may pass
the array in any order.

## Resolution rules

For each name in `identityKeys`, the value at `row[name]` is encoded
as follows:

| Value at `row[name]` | Encoded as | Rationale |
| --- | --- | --- |
| `undefined` | the literal token `__undef__` | Distinguishes "field missing" from a real value. |
| `null` | the literal token `__null__` | Distinguishes "explicit null" from `undefined`. |
| any other value | `JSON.stringify(value)` | Stable across processes; numbers, strings, booleans, nested objects all round-trip to the same bytes. |

```ts
identityFor('t', ['k'], { k: undefined }) !== identityFor('t', ['k'], { k: null })
identityFor('t', ['k'], { k: null })       !== identityFor('t', ['k'], { k: 'null' })
identityFor('t', ['k'], { k: 1 })          === identityFor('t', ['k'], { k: 1 })
```

This is why
[`mockDataset` collision detection](./mock-dataset.md#collisions)
treats `null` and `undefined` as separate identities — a dataset of
`{ k: null }` and `{ k: undefined }` is legal even though both look
"empty" to user code.

## Cross-references

- Identity tuples are the input to the dataset's
  [collision retry loop](./mock-dataset.md#collisions).
- For *cross-dataset* identity (FK), use
  [`relate(rows, field, opts?)`](./relate.md#relate) rather than
  matching identity strings by hand.
