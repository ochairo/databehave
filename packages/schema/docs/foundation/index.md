# Foundation types

Foundation types are the **shared vocabulary** that links the schema
DSL, the generator, the validator, and the dataset subsystem. They
are the types that appear in callback signatures and in the runtime
shape of the IR you receive when authoring a plugin or composing
schemas at the type level.

Pages:

- [types.md](./types.md) — public callable types (`DerivedFn`,
  `InvariantFn`), axis-override runtime shapes
  (`OccasionalOverride`, `EventuallyOverride`),
  `DomainConstraint`, `ModifierProbs` (cross-link), the
  [error hierarchy](./types.md#error-hierarchy)
  (`DataBehaveError`, `ConformError`, `SchemaConflictError`,
  `Issue`).

Cross-links to types covered elsewhere:

- [`Distribution`](../generator/distributions.md) (and the three
  branches `WeightedDistribution` / `NormalDistribution` /
  `TypicalDistribution`) — covered by the generator distributions
  page.
- [`GenContext`](../generator/sampling.md#gencontext) — covered by
  the generator sampling page.
- [`ModifierProbs`](../generator/sampling.md#mockoptionsmodifierprobs)
  — covered by the generator sampling page; reference signature is
  re-stated under [`types.md#modifierprobs`](./types.md#modifierprobs)
  for navigation.
- The IR-shape types that plugin authors consume — `Schema<T>`,
  `Modifiers`, `SchemaNode`, `Axes` — remain in
  [extending.md](../extending.md) until the plugin-author refresh
  lands.

Source:
[`src/foundation/`](../../src/foundation/) (`axes.ts`, `errors.ts`,
`types.ts`).
