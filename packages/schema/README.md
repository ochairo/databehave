<!-- markdownlint-disable MD033 MD041 -->

<div align="center">

# @databehave/schema

<b>Schemas for how data behaves</b>

[![npm version](https://img.shields.io/npm/v/@databehave/schema.svg)](https://www.npmjs.com/package/@databehave/schema)
[![CI](https://github.com/ochairo/databehave/actions/workflows/ci.yml/badge.svg)](https://github.com/ochairo/databehave/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A520.19-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

Most schema libraries describe what shape your data has. @databehave/schema describes how data behaves. It has a rich vocabulary for distributions, domains, derived fields, invariants, exceptions, and relations. It also has a determinism model that keeps data consistent across requests and code changes.

## Install

```sh
npm install @databehave/schema
# or: pnpm add @databehave/schema
# or: yarn add @databehave/schema
```

## A 60-second tour

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
  name: 'products', identity: ['sku'], n: 100,
  schema: obj({ sku: str(), name: str() }),
})
const orders = mockDataset({
  name: 'orders', identity: ['id'], n: 50,
  schema: obj({ id: str(), productSku: str().derivedFrom(relate(products, 'sku')) }),
})
```

**8. Weighted choice.** Non-uniform discrete sampling.

```ts
const Tier = enum_(['A', 'B', 'C']).weighted([['A', 0.7], ['B', 0.2], ['C', 0.1]])
```

## Documentation

- [Docs](docs/index.md) — documentation hub. Start here.
- [Getting started](docs/getting-started.md) — install + 5-minute hello-world.
- Reference: [DSL](docs/schema/index.md) · [Generator](docs/generator/index.md) · [Validator](docs/validator/index.md) · [Dataset](docs/dataset/index.md) · [Foundation](docs/foundation/index.md) · [Errors](docs/errors.md).
- Deeper: [Design](docs/design.md) · [Recipes](docs/recipes.md) · [Extending](docs/extending.md) · [Stability](docs/stability.md).

<br /><br />
<div align="center">

© 2026-present ochairo. See [LICENSE](LICENSE)

</div>
