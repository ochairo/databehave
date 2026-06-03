/**
 * @databehave/schema/internal — low-level extensibility surface.
 *
 * Re-exports the IR walker, the IR discriminants, the axis types, and
 * seeded PRNG primitives that exist for third-party packages (CLI tools,
 * OpenAPI ingestion, zod adapters, …) to build on. These are versioned
 * more loosely than the main DSL:
 *
 *   • SchemaNode / IR shape changes are MAJOR (see docs/stability.md).
 *   • PRNG output is deterministic across PATCH/MINOR for a given seed.
 *
 * **Do not import from `@databehave/schema/internal` in application code.**
 * Prefer the high-level `mock()` / `parse()` / `safeParse()` from the package
 * root. Importing internals couples you to the IR and bypasses fail-loud guards.
 */

export {
  walkSchema,
  fromIR,
  serializeSchema,
  deserializeSchema,
  IR_VERSION,
  type SchemaEnvelope,
  type SchemaVisitor,
  type WalkPath,
} from './foundation/walk.js'
export {
  mulberry32,
  rngFromString,
  seedFromString,
  type Rng,
} from './foundation/prng.js'

// ── extension-author types ─────────────────────────────────────────
//
// Surfaced so extension code (codegen, IR transforms, OpenAPI adapters)
// can name the IR discriminants and the `_applyAxes` argument shape
// without reaching into deep paths. Type-only re-exports — they emit
// no runtime JS.

export { Schema } from './foundation/types.js'
export type { Infer } from './foundation/types.js'

export type {
  // IR core + per-kind discriminants
  ArrayKind,
  BooleanKind,
  DecimalKind,
  DiscriminatedKind,
  EnumKind,
  LiteralKind,
  Modifiers,
  NullKind,
  NumberKind,
  ObjectKind,
  SchemaCore,
  SchemaNode,
  StringFormat,
  StringKind,
  TupleKind,
  UnionKind,
} from './foundation/ir.js'

export type {
  // Axis types (shape of `Modifiers.axes`)
  Axes,
  DerivedFn,
  Distribution,
  DomainConstraint,
  EventuallyOverride,
  GenContext,
  InvariantFn,
  NormalDistribution,
  OccasionalOverride,
  TypicalDistribution,
  WeightedDistribution,
} from './foundation/axes.js'
