# Validator

The validator verifies that a value conforms to a `Schema`. It has two
entry points:

- [`parse(schema, value)`](./api.md#parse) — returns
  `Infer<typeof schema>` on success, throws `ConformError` otherwise.
- [`safeParse(schema, value)`](./api.md#safeparse) — returns a
  discriminated `SafeParseResult<T>` (`{ ok: true, value }` /
  `{ ok: false, error }`).

Both share a single in-source implementation; `parse` is `safeParse`
that throws on failure. They never throw any error class other than
`ConformError` — see
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
| `invariants` (single-record) | Object-level predicates run after all fields are checked, with the assembled object as `value` and the parent as `ctx.parent`. |
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
[`src/validator/parse.ts`](../../src/validator/parse.ts) (file header
+ `check` switch).
