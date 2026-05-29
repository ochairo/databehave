# Extending databehave

databehave ships **no** CLI, OpenAPI ingestion, zod adapter, GUI, or HTTP layer.
These belong in *external* packages. This document is the contract those
packages should rely on.

## What databehave promises (and what it does not)

| Promise | Detail |
| --- | --- |
| Stable IR shape | `SchemaNode`, `Modifiers`, `Axes` are part of the semver contract. |
| Stable extension API | `walkSchema`, `fromIR`, `mulberry32`, `rngFromString`, `seedFromString`. |
| Determinism | Identical `(seed, input)` → identical output across Node versions in the support matrix. |
| Zero runtime deps | We will not add a dependency just to enable a plugin. |

| **Not** promised | |
| --- | --- |
| Builder class identity | `ObjectSchema`, `NumberSchema`, etc. may grow methods or be reorganised. **Do not subclass them.** |
| Internal helpers (anything not in `index.ts`) | May change in any release. |
| Specific output of `mock()` for a given seed | We try not to break it, but changes to the engine to fix bugs may shift values. Use snapshots responsibly. |

## The two extension points

### `walkSchema(node, visitor)` — read-only traversal

Use this for **codegen**: OpenAPI, JSON Schema, SQL DDL, documentation,
TypeScript types from runtime IR, etc.

```ts
import { walkSchema, type Schema, type SchemaNode } from 'databehave'

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

Visitor contract:

- `enter(node, path)` runs before children. Return `false` to skip the
  subtree.
- `leave(node, path)` runs after all children.
- `path` is `(string | number)[]` — JSON-pointer-style. Array items use
  `'[]'`; union branches use `'|0'`, `'|1'`, etc.

### `fromIR(node)` — reconstruct a builder

Useful when your plugin produces IR programmatically (e.g. parsing an
OpenAPI file) and wants to hand back a typed `Schema` to the user:

```ts
import { fromIR, type SchemaNode } from 'databehave'

const node: SchemaNode = parseOpenApi(spec)
const schema = fromIR(node)        // Schema<unknown>
// The plugin can cast to a precise type if it knows the shape:
//   const schema = fromIR(node) as Schema<MyType>
```

Modifiers (`nullable`, `optional`, `default`, `describe`, axes) are
preserved through the round-trip.

## Determinism helpers for plugins

If your plugin samples data on the side (e.g. example values for
documentation), use databehave's PRNG so behaviour matches `mock()`:

```ts
import { rngFromString, seedFromString, mulberry32 } from 'databehave'

const rng = rngFromString('my-plugin|examples')
rng.int(0, 100)         // 73 — same on every machine
rng.pick(['A','B','C']) // 'B'
```

For sub-RNGs that need to branch deterministically:

```ts
const sub = mulberry32(seedFromString(`${parentSeed}|child:${i}`))
```

## What you should *not* do

- **Do not subclass `Schema`, `ObjectSchema`, etc.** Builder classes
  are an implementation detail. Compose `fromIR` + existing builders
  instead.
- **Do not import from `databehave/dist/...`** or any deep path. Only the
  top-level `import { ... } from 'databehave'` is part of the public API.
- **Do not call `Math.random()` or `Date.now()`** inside `derivedFrom`
  or invariant callbacks. They break determinism and will fail
  `expectStable()`.
- **Do not mutate IR nodes returned by `walkSchema`.** Treat them as
  immutable. If you need a modified copy, use the builders + `fromIR`.

## Suggested plugin areas

- `@databehave/openapi` — `SchemaNode → OpenAPI document` and back.
- `@databehave/zod` — bridge for projects already invested in zod.
- `@databehave/sql` — emit Snowflake / Postgres `CREATE TABLE` from `obj({...})`.
- `@databehave/msw` — auto-generate msw handlers from a schema map.
- `@databehave/cli` — `databehave generate path/to/schema.ts --seed s --count 100`.

If you build one of these, open a PR adding it to the README "Ecosystem"
table.
