# Distributions

A **distribution** is sampling metadata attached under
`_node.mods.axes.distribution`. The generator inspects it during
sampling; the validator does not (distributions are sampling hints,
not conformance constraints — see
[validator/index.md](../validator/index.md)).

The distribution IR is a discriminated union with three branches:

```ts
import type { Distribution } from '@databehave/schema'
//   | { kind: 'weighted'; weights: ReadonlyArray<readonly [string|number|boolean, number]> }
//   | { kind: 'normal';   mean: number; stddev: number }
//   | { kind: 'typical';  from: number; to: number }
```

Each branch is its own type alias (`WeightedDistribution`,
`NormalDistribution`, `TypicalDistribution`), all re-exported from the
package main entry. Plugin authors walking the IR via `walkSchema`
will see these shapes verbatim.

The DSL operators that produce them
(`.weighted` / `.normal` / `.typically`) live on the matching schema
kinds — see
[`schema/bound-operators.md#weighted`](../schema/bound-operators.md#weighted)
for the build-time API and capability matrix. This page documents the
sampling-time math.

Source:
[`src/foundation/axes.ts`](../../src/foundation/axes.ts) (IR types),
[`src/generator/engine.ts`](../../src/generator/engine.ts) (sampling).

---

## Uniform (no distribution)

```ts
import { mock, num, int } from '@databehave/schema'

mock(num().min(0).max(1))      // uniform in [min, max)
mock(int().min(0).max(100))    // rng.int(min, max), inclusive both ends
```

When no `.weighted` / `.normal` / `.typically` is declared, primitives
fall through to type defaults: `num()` samples
`min + rng.next() * (max - min)`; `int()` samples `rng.int(min, max)`
inclusive on both ends. String primitives sample uniformly from the
alphanumeric alphabet up to the rune-count bounds; arrays pick a
uniform length within `[minLength, maxLength]`.

Source:
[`src/generator/engine.ts`](../../src/generator/engine.ts) (`genNumber`,
`genString`, `genArray`).

## `kind: 'weighted'`

```ts
import { mock, enum_ } from '@databehave/schema'

const status = enum_(['active', 'paused', 'archived'] as const)
  .weighted([['active', 8], ['paused', 1], ['archived', 1]])

mock(status)  // 'active' ~80% of the time
```

Weighted sampling normalises the supplied weights (`Math.max(0, w)`
each) into a cumulative distribution, then draws `rng.next() * total`
and walks the prefix sum. Negative weights are clamped to zero; if
**every** weight is non-positive the picker falls through to the
domain / type-default path. Weight values that are not present in the
underlying domain (`.in([...])`) are filtered out before sampling, so
weighted-with-domain combinations stay consistent.

Source:
[`src/generator/engine.ts`](../../src/generator/engine.ts) — see
`pickWeighted`, `sampleDiscrete`, `sampleFromDomain`.

## `kind: 'typical'`

```ts
import { mock, num } from '@databehave/schema'

const ratio = num().min(0).max(1).typically(0.6, 0.9)
mock(ratio)  // ∈ [0.6, 0.9] uniformly — clamped into [min, max] first
```

`.typically(from, to)` samples uniformly inside `[from, to]` after
clamping both endpoints into the schema's declared `[min, max]`. It is
the "most values lie here" knob — there is no tail outside the typical
range. For decimals, the value is rounded to the declared scale and
re-clamped to the integer-scaled bounds to absorb double-rounding
error.

Source:
[`src/generator/engine.ts`](../../src/generator/engine.ts) — see
`genNumber`, `genDecimal` (`dist.kind === 'typical'` branches).

## `kind: 'normal'`

```ts
import { mock, num } from '@databehave/schema'

const score = num().min(-3).max(3).normal(0, 1)
mock(score)  // standard normal, then clamped into [-3, 3]
```

Gaussian sampling uses the Box–Muller transform:

```txt
u1 = max(rng.next(), Number.EPSILON)
u2 = rng.next()
z  = sqrt(-2 * log(u1)) * cos(2π * u2)
v  = mean + z * stddev
```

The result is clamped into `[min, max]`. For integer schemas the
clamped value is rounded; for decimals it is rounded to the declared
scale.

Source:
[`src/generator/engine.ts`](../../src/generator/engine.ts) — see
`sampleNormal`, `genNumber`, `genDecimal`.

### Cross-platform caveat

`Math.log`, `Math.sqrt`, and `Math.cos` are
**implementation-defined** in ECMAScript. Different V8 builds and
libm implementations may produce slightly different last-bit results,
so do **not** assume byte-equality of `.normal(...)` samples across
platforms. `.weighted(...)`, `.typically(...)`, and uniform sampling
use only IEEE-754 arithmetic and `rng.next()` and **are** bit-exact —
those are the paths covered by the determinism contract in
[`stability.md`](../stability.md#determinism-contract).

## Discrete branch sampling

```ts
import { mock, discriminated, obj, literal, str } from '@databehave/schema'

const Event = discriminated('kind', {
  click: obj({ kind: literal('click'), x: str() }),
  view:  obj({ kind: literal('view'),  href: str() }),
}).weighted([['click', 9], ['view', 1]])

mock(Event).kind  // 'click' ~90% of the time
```

`discriminated(...)` honours `.weighted` on the **discriminator tag
set**: weights whose first element is not a current branch tag are
filtered out, and the remaining weights drive `pickWeighted`.
Untagged `union(...)` falls through to uniform branch choice (no
`.weighted` support — see the [capability
matrix](../schema/bound-operators.md#capability-matrix)).

Source:
[`src/generator/engine.ts`](../../src/generator/engine.ts) (the
`'discriminated'` case in `sampleByKind`).
