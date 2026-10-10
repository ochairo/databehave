# Validator

The validator verifies that a value conforms to a `Schema`. It has two
entry points:

- [`parse(schema, value)`](./api.md#parse) — returns
  `Infer<typeof schema>` on success, throws `ConformError` otherwise.
- [`safeParse(schema, value)`](./api.md#safeparse) — returns a
  discriminated `SafeParseResult<T>` (`{ ok: true, value }` /
  `{ ok: false, error }`).

Both use `standardRuntime`; custom compositions use `runtime.parse` and `runtime.safeParse`.
`parse` throws collected conformance issues as `ConformError`; `safeParse` returns them.
Invalid metadata/registration and external callback failures can still throw — see
[`design.md` §7](../design.md#7-error-model) for the broader error
model, and
[`stability.md`](../stability.md) for the SemVer commitments around
the error hierarchy.

Source:
[`src/validator/parse.ts`](../../src/validator/parse.ts).

---

## What the validator checks

In addition to **shape** (kind, primitive bounds, enum membership,
discriminator dispatch), the validator enforces the conformance-shaped
subset of [data-schema axes](../schema/bound-operators.md):

| Axis | Behaviour at `parse(...)` |
| --- | --- |
| `domain` (`values` / `lookup`) | Value must be in the closed set; `lookup` resolves the candidate set from the sibling `parent[fromField]`. |
| `invariants` (single-record) | Primitive and composite predicates run after downstream validation, with the checked value and parent context. |
| `correlate` (multi-field) | Implemented as object-kind invariants — same axis, typed against the inferred object shape. |
| `derived` | The supplied value must deep-equal `derivedFrom(ctx)`; mismatches surface as `'derived value does not match computed value'`. |

`distribution` (`weighted` / `normal` / `typical`) is **not**
validated. Distributions are sampling hints, not conformance
constraints — a value that lives outside a `.typically(...)` band but
inside the declared `[min, max]` is still legal input.

Modifier short-circuits behave as expected: `undefined` is accepted
when the field is `.optional()`; `null` is accepted when the field is
`.nullable()`; if `undefined` appears for a `.default(v)` field the
validator emits `defaultValue` (mirroring the generator's behaviour
when `modifierProbs.default` fires — see
[`generator/sampling.md#mockoptionsmodifierprobs`](../generator/sampling.md#mockoptionsmodifierprobs)).

For the full API surface (signatures, error class, examples), see
[api.md](./api.md).

Source:
[`src/runtime/runtime.ts`](../../src/runtime/runtime.ts),
[`src/standard/kinds.ts`](../../src/standard/kinds.ts) and
[`src/standard/behaviors.ts`](../../src/standard/behaviors.ts).
