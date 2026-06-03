# DSL reference

The `@databehave/schema` DSL has four layers: **primitives** (scalar
type builders), **composites** (objects, arrays, tuples, unions,
literals, enums, discriminated unions), **universal modifiers** that
apply to every schema (`.nullable`, `.optional`, `.default`,
`.describe`), and **bound operators** that depend on the schema's
kind (string bounds, numeric bounds, axes such as `.weighted` /
`.typically` / `.invariant`).

Every entry on these pages mirrors a real export from
[`src/index.ts`](../../src/index.ts). Code samples type-check against
the actual source signatures — no synthetic API.

- [primitives.md](./primitives.md) — `str`, `num`, `int`, `decimal`,
  `bool`, `null_`.
- [composites.md](./composites.md) — `obj`, `arr`, `tuple`, `union`,
  `literal`, `enum_`, `discriminated`.
- [modifiers.md](./modifiers.md) — `.nullable`, `.optional`,
  `.default`, `.describe` (universal — apply to every `Schema<T>`).
- [bound-operators.md](./bound-operators.md) — kind-bound operators:
  string `min`/`max`/`pattern`, numeric `min`/`max`, decimal
  `min`/`max`, array `length`/`min`/`max`, the capability matrix,
  and the axis operators `.weighted`, `.normal`, `.typically`,
  `.occasionally`, `.eventually`, `.derivedFrom`, `.invariant`,
  `.in`, `.correlate`, plus the axis priority order the generator
  evaluates.

For the surrounding subsystems — generator (`mock`), validator
(`parse` / `safeParse`), dataset (`mockDataset`, `relate`), the IR
plugin contract, and the stability / determinism contract — see the
sibling pages in [`../`](../). They are not part of this slice.
