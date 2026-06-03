# Extending databehave

databehave ships **no** CLI, OpenAPI ingestion, zod adapter, GUI, or
HTTP layer. These belong in *external* packages. This document is
the contract those packages should rely on.

For SemVer guarantees on every symbol named below see
[stability.md](./stability.md).

## What databehave promises (and what it does not)

| Promise | Detail |
| --- | --- |
| Stable IR shape | `SchemaNode`, `Modifiers`, `Axes` are part of the SemVer contract. |
| Stable extension API | `walkSchema`, `fromIR`, `mulberry32`, `rngFromString`, `seedFromString`. |
| Determinism | Identical `(seed, input)` → identical output across Node versions in the support matrix. |
| Zero runtime deps | We will not add a dependency just to enable an extension. |

| **Not** promised | |
| --- | --- |
| Builder class identity | `ObjectSchema`, `NumberSchema`, etc. may grow methods or be reorganised. **Do not subclass them.** |
| Internal helpers (anything not in `index.ts` or `@databehave/schema/internal`) | May change in any release. |
| Specific output of `mock()` for a given seed | We try not to break it, but engine fixes may shift values. Use snapshots responsibly. |

## Extension-author imports {#extension-imports}

The extensibility surface ships from a single deep entry point:

- **`@databehave/schema/internal`** — `walkSchema`, `fromIR`,
  `SchemaVisitor`, `WalkPath`, `mulberry32`, `rngFromString`,
  `seedFromString`, `Rng`, plus `serializeSchema`,
  `deserializeSchema`, `IR_VERSION`, `SchemaEnvelope`. Extension code
  must import from here; the package root carries the user-facing
  DSL only.

```ts
import { walkSchema, fromIR } from '@databehave/schema/internal'
```

Source:
[`src/internal.ts`](../src/internal.ts).

## The two extension points

### `walkSchema(node, visitor)` — read-only traversal {#walkschema}

Use this for **codegen**: OpenAPI, JSON Schema, SQL DDL,
documentation, TypeScript types from runtime IR, etc.

```ts
import { walkSchema, type Schema, type SchemaNode } from '@databehave/schema/internal'

export const toJsonSchema = (schema: Schema): unknown => {
  const stack: unknown[] = []

  walkSchema(schema, {
    enter(node, path) {
      // Pre-order: stash a partial fragment for this node.
      stack.push(scaffoldFor(node))
    },
    leave(node, path) {
      // Post-order: fold the top-of-stack into its parent.
      const built = stack.pop()
      attachToParent(stack, node, path, built)
    },
  })

  return stack[0]
}
```

`walkSchema` accepts either a `Schema` builder *or* a raw
`SchemaNode` (for extensions that synthesise IR programmatically). It
returns `void` — the visitor is the side-channel.

Source:
[`src/foundation/walk.ts:46-90`](../src/foundation/walk.ts).

### `fromIR(node)` — reconstruct a builder {#fromir}

Useful when your extension produces IR programmatically (e.g. parsing
an OpenAPI file) and wants to hand back a typed `Schema` to the
user:

```ts
import { fromIR, type SchemaNode } from '@databehave/schema/internal'

const node: SchemaNode = parseOpenApi(spec)
const schema = fromIR(node)        // Schema<unknown>
// The extension can cast to a precise type if it knows the shape:
//   const schema = fromIR(node) as Schema<MyType>
```

Modifiers (`nullable`, `optional`, `default`, `describe`, axes) are
preserved through the round-trip via the public
[`Schema._applyAxes`](#schema-base) helper.

Source:
[`src/foundation/walk.ts:96-162`](../src/foundation/walk.ts).

## Extension-author API reference

The four types below are the surface that extension code consumes.
Each is part of the SemVer contract under
[stability.md#extension-contract-ir](./stability.md#extension-contract-ir).

### `Schema` base {#schema-base}

```ts
class Schema<out T = unknown> {
  declare readonly _type: T          // phantom — compile-time only
  readonly _node: SchemaNode         // serialisable IR
  // modifiers + axes return a new builder; Schema itself is immutable
  nullable():  Schema<T | null>
  optional():  Schema<T | undefined>
  default(v: T): Schema<T>
  describe(text: string): this
  // …axis builders (.weighted, .normal, .typically, .occasionally,
  // .eventually, .derivedFrom, .invariant, .in)…
  /** Public so `fromIR` can replay a complete `Axes` record without casts. */
  _applyAxes(axes: Axes): this
}
```

`Schema<T>` is the abstract builder every concrete schema kind
extends (`ObjectSchema`, `NumberSchema`, …). Extension authors must
**not** subclass `Schema` — the subclass identities are an
implementation detail. The supported pattern is to construct IR (or
compose existing builders) and call [`fromIR`](#fromir).

`_node` and `_applyAxes` are the only members of `Schema` you should
touch from extension code. `_type` is a phantom marker carried only at
compile time; it has no runtime representation.

```ts
import { obj, str, type Schema, type SchemaNode } from '@databehave/schema'

const ir: SchemaNode = obj({ id: str() })._node
// Hand the IR to a codegen tool, then later round-trip it back:
//   const rebuilt: Schema<unknown> = fromIR(ir)
```

Source:
[`src/foundation/types.ts:16-119`](../src/foundation/types.ts).

### `SchemaVisitor` {#schemavisitor}

```ts
type SchemaVisitor = {
  readonly enter?: (node: SchemaNode, path: WalkPath) => void | boolean
  readonly leave?: (node: SchemaNode, path: WalkPath) => void
}
```

Visitor contract for [`walkSchema`](#walkschema):

- `enter(node, path)` runs **before** descending into children.
  Return literal `false` to skip the subtree (any other return —
  including `undefined`, `true`, or no `return` — descends).
- `leave(node, path)` runs **after** all children have been
  visited.
- Both callbacks are optional. A visitor with neither is a no-op
  full-tree walk.

```ts
import { walkSchema, type SchemaVisitor } from '@databehave/schema/internal'

const collectStrings: SchemaVisitor = {
  enter(node, path) {
    if (node.kind === 'string') {
      console.log('string at', path.join('/'), 'min=', node.min)
    }
  },
}

walkSchema(mySchema, collectStrings)
```

Visitors may close over their own state (a stack, a builder, a map);
the walker itself never mutates the visitor. Treat the `node`
argument as immutable — do not write through it.

Source:
[`src/foundation/walk.ts:36-42`](../src/foundation/walk.ts).

### `WalkPath` {#walkpath}

```ts
type WalkPath = readonly (string | number)[]
```

JSON-pointer-style location of the current node in the schema tree,
passed to every `enter` / `leave` callback. The empty path `[]`
means "the root". The walker emits four step kinds:

| Step | Emitted by | Example |
| --- | --- | --- |
| Object key (`string`) | `obj({ ... })` | `['items']` |
| Array element (`'[]'`) | `arr(...)` | `['items', '[]']` |
| Tuple index (`number`) | `tuple(...)` | `[0]`, `[1]` |
| Union/discriminated branch (`` `\|i` ``) | `union(...)`, `discriminated(...)` | `['kind', '\|0']` |

```ts
import { obj, arr, str } from '@databehave/schema'
import { walkSchema } from '@databehave/schema/internal'

walkSchema(obj({ tags: arr(str()) }), {
  enter(_node, path) { console.log(path) }
})
// []
// ['tags']
// ['tags', '[]']
```

Source:
[`src/foundation/walk.ts:34`](../src/foundation/walk.ts).

### `Rng` {#rng}

```ts
type Rng = {
  next():                         number   // ∈ [0, 1)
  int(min: number, max: number):  number   // inclusive both ends
  pick<T>(items: readonly T[]):   T        // uniform
}
```

The deterministic PRNG interface. Returned by
[`mulberry32(seed)`](#mulberry32) and
[`rngFromString(s)`](#rngfromstring). Three runtime guard rails are
part of the SemVer contract:

- `int(min, max)` throws `RangeError` if either bound is non-finite
  (`NaN`, `±Infinity`).
- `int(min, max)` throws `RangeError` if `min > max`.
- `pick(items)` throws `RangeError` when `items.length === 0`.

```ts
import { rngFromString } from '@databehave/schema/internal'

const rng = rngFromString('plugin|examples')
rng.next()                    // e.g. 0.7212347...
rng.int(1, 6)                 // e.g. 4
rng.pick(['A', 'B', 'C'])     // e.g. 'B'

rng.int(NaN, 10)              // RangeError: rng.int requires finite bounds, …
rng.int(10, 5)                // RangeError: rng.int: min (10) > max (5)
rng.pick([])                  // RangeError: rng.pick: empty array
```

Source:
[`src/foundation/prng.ts:11-19`](../src/foundation/prng.ts) (interface),
[`src/foundation/prng.ts:25-55`](../src/foundation/prng.ts) (implementation +
guard rails).

## Determinism helpers for extensions

If your extension samples data on the side (e.g. example values for
documentation), use databehave's PRNG so behaviour matches `mock()`.

### `mulberry32` {#mulberry32}

```ts
const mulberry32: (seed: number) => Rng
```

Tiny, fast, deterministic 32-bit PRNG. Identical seed → identical
sequence on every machine. Period ≈ 2³². Pair with
[`seedFromString`](#seedfromstring) for string-seeded sub-RNGs:

```ts
import { mulberry32, seedFromString } from '@databehave/schema/internal'

const sub = mulberry32(seedFromString(`${parentSeed}|child:${i}`))
```

Source:
[`src/foundation/prng.ts:25-55`](../src/foundation/prng.ts).

### `rngFromString` {#rngfromstring}

```ts
const rngFromString: (s: string) => Rng
```

Convenience wrapper: `mulberry32(seedFromString(s))`.

```ts
import { rngFromString } from '@databehave/schema/internal'

const rng = rngFromString('my-plugin|examples')
rng.int(0, 100)         // same number on every machine
rng.pick(['A','B','C']) // same pick on every machine
```

Source:
[`src/foundation/prng.ts:69-71`](../src/foundation/prng.ts).

### `seedFromString` {#seedfromstring}

```ts
const seedFromString: (s: string) => number
```

FNV-1a 32-bit hash of an arbitrary string. Use to derive a numeric
seed for `mulberry32` from a domain-specific identifier (dataset
name, extension id, row identity, …):

```ts
import { mulberry32, seedFromString } from '@databehave/schema/internal'

const sub = mulberry32(seedFromString(`my-plugin|row:${rowId}`))
```

Source:
[`src/foundation/prng.ts:58-66`](../src/foundation/prng.ts).

## What you should *not* do

- **Do not subclass `Schema`, `ObjectSchema`, etc.** Subclasses are
  an internal implementation detail of `@databehave/schema`; external
  code composes via `fromIR` + existing builders instead.
- **Do not import from `@databehave/schema/dist/...`** or any deep
  path other than `@databehave/schema/internal`. Only the top-level
  and explicit `internal` entry points are part of the public API.
- **Do not call `Math.random()` or `Date.now()`** inside
  `derivedFrom` or invariant callbacks. They break determinism and
  will fail [`expectStable`](./generator/trace-replay.md#expectstable).
- **Do not mutate IR nodes returned by `walkSchema`.** Treat them
  as immutable. If you need a modified copy, use the builders +
  `fromIR`.
