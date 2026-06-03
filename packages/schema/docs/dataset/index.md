# Dataset

A **dataset** is a collection of records that share a per-record
[`Schema`](../schema/index.md), an identity-key tuple, a record count,
and optional aggregate invariants. Same identity tuple → same row,
deterministically, across calls and across processes.

This subsystem is built around two entry points and one helper:

- [`mockDataset(opts)`](./mock-dataset.md#mockdataset) — generate `n`
  rows with identity uniqueness + aggregate invariants enforced.
- [`relate(rows, field, opts?)`](./relate.md#relate) — declarative
  cross-dataset foreign key, returns a `DerivedFn` for use with
  [`.derivedFrom(...)`](../schema/bound-operators.md#derivedfrom).
- [`identityFor(name, identity, row)`](./identity.md#identityfor) —
  compute the deterministic identity key string for a row (used by
  `mockDataset` itself; exported for cross-dataset lookups).

Pages:

- [mock-dataset.md](./mock-dataset.md) — `mockDataset` entry point,
  `DatasetOptions` reference, collision behaviour, errors thrown.
- [relate.md](./relate.md) — `relate(rows, field, opts?)`,
  `RelateOptions.pickBy`, cross-link to the
  [cross-dataset FK recipe](../recipes.md#cross-dataset-foreign-keys).
- [identity.md](./identity.md) — `identityFor` and the identity-key
  resolution rules (sorted, JSON-stringified, with explicit
  `null` / `undefined` distinguished).

Source:
[`src/dataset/dataset.ts`](../../src/dataset/dataset.ts),
[`src/dataset/relate.ts`](../../src/dataset/relate.ts).
