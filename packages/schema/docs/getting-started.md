# Getting started

> If you have a TypeScript project and want a deterministic data
> generator + runtime validator in five minutes, you're in the right
> place.

This is the tutorial. For the full DSL reference see
[schema/](./schema/index.md); for every generator option see
[generator/](./generator/index.md); for the validator surface see
[validator/](./validator/index.md).

## Install

```sh
npm install @databehave/schema
# or: pnpm add @databehave/schema
# or: yarn add @databehave/schema
```

`@databehave/schema` is zero-dependency. `dependencies: {}` and
`peerDependencies: {}` are enforced by package metadata.

## Step 1 — Describe a schema

Schemas are built with composable functions. The phantom type
parameter on every builder gives you full type inference back from
[`Infer<S>`](./foundation/index.md), `mock`, and `parse`.

```ts
import { obj, str, int, decimal, enum_ } from '@databehave/schema'

const Product = obj({
  sku:    str().min(3).max(12).pattern(/^[A-Z0-9-]+$/),
  name:   str().min(1).max(80),
  price:  decimal(10, 2).min('0').max('1000').typically(50, 500),
  units:  int().min(0).max(10_000),
  tier:   enum_(['standard', 'premium', 'enterprise'] as const),
})
```

A schema is just a description — nothing has been generated or
validated yet. Per-builder reference:
[schema/primitives.md](./schema/primitives.md),
[schema/composites.md](./schema/composites.md).

## Step 2 — Sample a value

[`mock(schema, options?)`](./generator/sampling.md#mock) turns the
schema into a concrete value. Identical seed → identical value, on
every machine, on every Node major in the support matrix.

```ts
import { mock } from '@databehave/schema'

const a = mock(Product, { seed: 'demo' })
const b = mock(Product, { seed: 'demo' })
// a deep-equals b — guaranteed by the determinism contract.
```

The default seed is the literal string `'databehave'`; supply your
own to vary output. See
[generator/seed.md](./generator/seed.md) for the seed pipeline.

## Step 3 — Validate a value

[`safeParse`](./validator/api.md#safeparseschema-value) returns a
discriminated result; [`parse`](./validator/api.md#parseschema-value)
throws [`ConformError`](./foundation/types.md#conformerror) on
failure.

```ts
import { safeParse } from '@databehave/schema'

const result = safeParse(Product, await fetchProduct())
if (result.ok) {
  // result.value is typed `Infer<typeof Product>`.
  console.log(result.value.sku)
} else {
  for (const issue of result.error.issues) {
    console.error(issue.path.join('.'), issue.message)
  }
}
```

Validator behavioural axes (domain, single-record invariants,
multi-field `correlate`, derived-field equality) are listed in
[validator/index.md#what-the-validator-checks](./validator/index.md).

## Step 4 — Generate a dataset

A schema for one record + an identity tuple + a row count gives you
a deterministic, collision-free dataset.

```ts
import { mockDataset } from '@databehave/schema'

const products = mockDataset({
  name:     'products',
  schema:   Product,
  identity: ['sku'],
  n:        100,
  seedPrefix: 'demo',
})
```

Two datasets can share keys via
[`relate(rows, field, opts?)`](./dataset/relate.md#relate); see
[recipes.md#cross-dataset-foreign-keys](./recipes.md).

## Where to next

| You want to … | Read |
| --- | --- |
| Shape distributions, domains, cadence | [schema/bound-operators.md](./schema/bound-operators.md) |
| Diagnose a failed sample | [errors.md](./errors.md) + [foundation/types.md#error-hierarchy](./foundation/types.md#error-hierarchy) |
| Inspect every axis the generator fired | [generator/trace-replay.md](./generator/trace-replay.md) |
| Lock a value across CI runs | [generator/trace-replay.md#expectstable](./generator/trace-replay.md#expectstable) |
| Build a plugin (codegen, OpenAPI, zod) | [extending.md](./extending.md) |
| Understand SemVer guarantees | [stability.md](./stability.md) |
