<!-- markdownlint-disable MD033 MD041 -->

<div align="center">

# databehave

**Schemas for how data behaves, not just its shape.**

[![npm version](https://img.shields.io/npm/v/databehave.svg)](https://www.npmjs.com/package/databehave)
[![CI](https://github.com/ochairo/databehave/actions/workflows/test.yml/badge.svg)](https://github.com/ochairo/databehave/actions/workflows/test.yml)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A518.17-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

Most schema libraries describe **what shape** your data has. `databehave`
describes **how it behaves** — distributions, identity, derived values,
invariants, and domain rules — so a single declaration is your TypeScript
type, your runtime validator, and your deterministic sample-data generator.

Scope is deliberately narrow: data schemas, nothing else. No HTTP server, no
CLI, no framework adapter — drop it into the stack you already use.

## Install

```sh
npm install databehave
# or: pnpm add databehave
# or: yarn add databehave
```

Requires Node.js ≥ 18.17. No transitive dependencies.

> `v0.3.0` early but ready for use within its scope. Breaking changes will
> follow semver and be noted in [CHANGELOG.md](CHANGELOG.md). Maintained by
> [@ochairo](https://github.com/ochairo). Issues and PRs welcome.

## A 60-second tour

One minimal snippet per modelling axis. They compose freely — nest them
inside `obj({...})` to build real schemas.

**1. Distribution.** Shape where values concentrate inside the bounds.

```ts
const Price = decimal(10, 2).min('0').max('1000').typically(100, 300)
```

**2. Domain.** Closed candidate set, optionally keyed off a sibling field.

```ts
const Region   = str().in(['us', 'eu', 'jp'])
const Currency = str().in({
  kind: 'lookup', fromField: 'region',
  map: { us: ['USD'], eu: ['EUR'], jp: ['JPY'] },
})
```

**3. Derived.** Computed from sibling fields, never sampled — stays
consistent by construction.

```ts
const Total = int().derivedFrom(
  ctx => (ctx.parent.qty as number) * (ctx.parent.price as number),
)
```

**4. Invariants.** Single- and multi-field predicates enforced by rejection
sampling.

```ts
const Even = int().min(0).max(100).invariant(v => (v as number) % 2 === 0)
const Box  = obj({ w: int(), h: int() }).correlate(o => o.w >= o.h)
```

**5. Occasional & periodic overrides.** Rare random or deterministic
exceptions stacked over the base distribution.

```ts
const Quantity  = int().min(0).max(10).occasionally(-1, 0.01)   // 1% chance of -1
const Heartbeat = int().min(0).max(99).eventually(10, 999)      // every 10th value is 999
```

**6. Discriminated unions.** Shape switches on a literal field.

```ts
const Variant = discriminated('kind', {
  digital:  obj({ kind: literal('digital'),  downloadUrl: str() }),
  physical: obj({ kind: literal('physical'), weightKg: decimal(6, 2) }),
})
```

**7. Identity & relations.** Stable records keyed by identity, plus
cross-dataset foreign keys.

```ts
const products = mockDataset({
  name: 'products', schema: Product, identity: ['sku'], n: 100,
})
const orders = mockDataset({
  name: 'orders', schema: Order, identity: ['id'], n: 50,
  fields: { productSku: relate(products, 'sku') },
})
```

**8. Weighted choice.** Non-uniform discrete sampling.

```ts
const Tier = enum_(['A', 'B', 'C']).weighted([['A', 0.7], ['B', 0.2], ['C', 0.1]])
```

**Putting it together.** Same seed → same value, every run, every platform.

```ts
mock(Tier, { seed: 'demo' })          // → 'A' (deterministic)
parse(Tier, 'A')                      // throws on shape mismatch
type Tier = Infer<typeof Tier>        // 'A' | 'B' | 'C'
```

> **Purity matters.** Determinism depends on your code being pure. Any
> `Math.random()` or `Date.now()` inside a `derivedFrom` callback silently
> breaks it. Use [`expectStable`](docs/recipes.md) in CI to catch divergence.
> `.normal(...)` uses `Math.log`/`Math.cos`, which are implementation-defined
> in ECMAScript and not guaranteed bit-exact across V8 builds; the uniform
> and `.typically(...)` paths are bit-exact.

> **`optional` / `nullable` / `default` do not inject randomness by default.**
> Under `mock()`, fields with those modifiers always sample a real value.
> Set `MockOptions.modifierProbs` (e.g. `{ optional: 0.1, nullable: 0.1,
> default: 0.2 }`) to exercise those code paths probabilistically.

## Wiring into an HTTP framework

`databehave` ships no server. Write the response body as a pure function of
the request, then bind it to any transport — Hono, Express, Fastify, `msw`,
`node:http`.

```ts
// items.mock.ts — the only file that touches databehave
import { obj, int, decimal, mockDataset } from 'databehave'

const Item = obj({ id: int().min(1), price: decimal(10, 2).min('0').max('10000') })

export const itemsResponse = (query: Record<string, string>) => ({
  result: mockDataset({
    name: 'items', schema: Item, identity: ['id'], n: 10,
    seedPrefix: `GET:/items:${new URLSearchParams(query).toString()}`,
  }),
})
```

Bind it to any transport:

```ts
// Hono
app.get('/items', (c) => c.json(itemsResponse(c.req.query())))

// Express
app.get('/items', (req, res) => res.json(itemsResponse(req.query as any)))

// msw (tests)
http.get('/items', ({ request }) =>
  HttpResponse.json(itemsResponse(Object.fromEntries(new URL(request.url).searchParams))))
```

See [docs/recipes.md](docs/recipes.md) for Fastify, `node:http`, and
stable-seed patterns.

> Want a config-driven mock server that already does this wiring? See the
> companion package [`databehave-kit`](https://www.npmjs.com/package/databehave-kit).

## Documentation

- [Design](docs/design.md) — architecture, axis priority, the
  determinism model.
- [Axes](docs/axes.md) — full reference for every axis and modifier.
- [Recipes](docs/recipes.md) — practical patterns: FK, cadence, lookup
  domains, snapshot tests.
- [Extending](docs/extending.md) — plugin author guide.
- [CHANGELOG](CHANGELOG.md) — release notes.
- [CONTRIBUTING](CONTRIBUTING.md) — local development workflow.
- [SECURITY](SECURITY.md) — how to report a vulnerability.

## License

MIT © 2026-present ochairo. See [LICENSE](LICENSE).
