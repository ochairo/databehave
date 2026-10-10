# Schema plugins

Compose a synchronous runtime with explicit, instance-local registrations:

```ts
import { createSchemaRuntime } from '@databehave/schema/runtime'
import { standardKinds, standardBehaviors } from '@databehave/schema/standard'
import { obj, arr } from '@databehave/schema'

const runtime = createSchemaRuntime({
  kinds: [...standardKinds, money],
  behaviors: [...standardBehaviors, rounding],
})
const order = obj({ prices: arr(rounding.apply(money.schema({ ceiling: 1000 }), 10)) })
const value = runtime.mock(order, { seed: 'order-1' })
runtime.parse(order, value)
```

`money` and `rounding` above are descriptors authored with `defineKind` and `defineBehavior`.
The executable public-contract example is `test/runtime/plugins.test.ts`. It implements a USD money kind,
rounding behavior, nested arrays/objects, traversal, validation, replay, and JSON round-trip.
See also the [runnable schema example](../../../examples/schema.mjs) and
[application plugin guide](../../../docs/plugins.md).

A kind descriptor owns `checkMetadata`, `generate`, `validate`, `children`, and `rebuild`. Its `id` is the node's
`kind`, and its positive integer `version` identifies the contract. `checkMetadata(unknown)` must validate its
own metadata and return a node. The runtime validates recursive children and registered behavior metadata.
`children` exposes path segments; `rebuild` receives validated or reconstructed children and preserves all metadata.
An optional `describe` callback supplies diagnostic text. Composite implementations recurse through the supplied
context's `generate`/`check`, retaining the selected runtime. They can use `isDeferred` to process derived fields
once their siblings are available. Standard primitives and composites follow this same protocol.

`defineKind<Value, Node>(definition)` produces a descriptor with `.schema(metadata): Schema<Value>`. Use a
specific node type such as `{ kind: 'money'; ceiling: number; mods?: Modifiers }`. The builder requires its typed
metadata, infers `Value`, and composes with existing `obj`, `arr`, `tuple`, and `union` builders. No internal builder
subclass or global registration is needed.

`defineBehavior<Metadata>(definition)` produces a descriptor with `.apply(schema, metadata)`, preserving the schema's
inferred type. It stores metadata under `mods.behaviors[id]`. Each behavior owns applicability, metadata validation,
merge semantics, generation and validation middleware, and serialization. `runtime.withBehavior(schema, id, unknown)`
is the dynamically validated alternative. A descriptor can also implement `read` and `write` for its own metadata
carrier, as the standard modifier and axis descriptors do.

Generation phases are `modifier`, `derived`, `cadence`, `invariant`, and `sample`. Descriptor composition order is
stable within each phase. The standard group places `eventually` before `occasionally`, then wraps domain,
distribution and kind sampling in bounded invariant retries. Modifier, derived and cadence short circuits bypass
invariants. Validation is a separate middleware operation and enforces invariants on both primitive and composite
values; this corrects the previous omission of primitive invariant checks.

Generation middleware can call `next({ candidates, fallback })` to supply a `SamplingContext` to downstream
behaviors. They receive it as `context.sampling`; terminal generation calls its `fallback` instead of the kind.
Calling `next()` preserves the scope received by the caller. Each override belongs only to that continuation call:
repeated calls do not inherit an earlier override, and `context.generate` always starts a fresh node scope.
The standard domain behavior resolves candidates and supplies uniform fallback sampling. The distribution behavior
alone owns weighting: it filters weights against scoped candidates and delegates to fallback if no weight can be
selected. Domain does not inspect distribution metadata, so replacing distribution works for domain schemas too.
Composition order within the sample phase remains explicit; distribution must follow domain to receive its candidates.

The helpers snapshot definition identities and callback references when called; the runtime does the same for public
descriptor fields during construction and seals its registries. Class prototype methods are supported, and callbacks
retain their original receiver, including private fields. Mutating identities or replacing callbacks later does not
replace a registered contract. Receiver state and closure state remain extension-owned and are not deeply frozen.
Duplicate IDs, invalid versions,
and missing handlers fail synchronously. Missing registrations or invalid metadata fail before schema execution.
Plugin functions are trusted executable code: closure state and nondeterministic I/O remain the author's responsibility.
Replace a standard descriptor by omitting it from the array and supplying another with the same contract identity.
There is no asynchronous startup, module-side-effect registration, live replacement, HTTP, or application host requirement.

`walkSchema`, `fromIR`, `serializeSchema`, and `deserializeSchema` are runtime methods. IR envelope version 2 records
all required kind and behavior contract versions; deserialization starts from `unknown`, validates the complete tree,
and rejects missing, extra, duplicate, or incompatible contracts. Version 1 envelopes require explicit migration;
the runtime never rewrites persisted files. Serialization rejects closures, cycles and other data that JSON would lose,
including closure-bearing custom behavior metadata. Keep executable callbacks in process and use `runtime.replay`.

Seeded results are stable for the same schema, options, deterministic plugin implementations/versions and fixed runtime conditions.
Trace entries and replay capture the participating contracts. `runtime.mockDataset` uses the same selected generator
for every row, including custom nested kinds. Root `mock`, `parse`, `safeParse`, and the existing internal traversal
helpers are convenience functions bound to the immutable `standardRuntime` composition.

`runtime.replay` snapshots schema metadata and JSON input, retaining callbacks and the selected runtime in process.
It cannot freeze mutable callback/receiver state or make nondeterministic plugins reproducible. Contract IDs and
versions record dependencies, not hashes of implementations. See the [stability contract](stability.md).

## Minimal external kind and behavior

This example models money as integer cents and adds a serializable rounding step. Both definitions use public APIs:

```ts
import { defineKind, defineBehavior, type Modifiers } from '@databehave/schema/runtime'

/** Money metadata; common modifiers are validated by the runtime. */
type MoneyNode = { kind: 'money'; ceiling: number; mods?: Modifiers }
const money = defineKind<number, MoneyNode>({
  id: 'money', version: 1,
  checkMetadata(input) {
    if (input === null || typeof input !== 'object' || !('kind' in input) || input.kind !== 'money'
      || !('ceiling' in input) || typeof input.ceiling !== 'number'
      || !Number.isSafeInteger(input.ceiling) || input.ceiling < 1) throw new TypeError('invalid money metadata')
    return input as MoneyNode
  },
  generate: (node, ctx) => ctx.leafRng().int(0, node.ceiling),
  validate(node, value, ctx) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > node.ceiling)
      ctx.issues.push({ path: ctx.path, code: 'money.invalid', message: 'expected bounded integer cents' })
    return value
  },
  children: () => [],
  rebuild: (node) => ({ ...node }),
})
const rounding = defineBehavior<number>({
  id: 'rounding', version: 1, phase: 'sample',
  checkMetadata(value) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new TypeError('invalid step')
    return value
  },
  appliesTo: (node) => node.kind === 'money',
  merge: (_previous, next) => next,
  generate(step, _node, _ctx, next) {
    const value = next()
    if (typeof value !== 'number') throw new TypeError('money generator must return a number')
    return Math.floor(value / step) * step
  },
  validate(step, _node, value, ctx, next) {
    if (typeof value === 'number' && value % step !== 0)
      ctx.issues.push({ path: ctx.path, code: 'rounding.invalid', message: 'expected a multiple of step' })
    return next()
  },
  serialize: (step) => step,
})
```

Use these definitions in the composition example above. `Infer<typeof order>` contains numeric prices; a custom
kind can instead return structured data, as the tested USD example does.

## Optional application composition

Only applications using the host need the optional `@databehave/core` peer:

```ts
import { createHost } from '@databehave/core'
import { schemaPlugin, schemaCapability } from '@databehave/schema/plugin'

const app = createHost({ plugins: [schemaPlugin({ kinds: standardKinds, behaviors: standardBehaviors })] })
await app.start()
const schemaRuntime = app.get(schemaCapability)
// Consume schemaRuntime in application services or other declared-capability plugins.
await app.close()
```

The adapter creates a distinct runtime for each host during synchronous setup. It adds no network listener,
resource acquisition, or mandatory application lifecycle to standalone schema use.
