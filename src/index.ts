/**
 * databehave — Zero-dependency data schema DSL.
 *
 * Public surface:
 *   - schema DSL (primitives, composites, decimal, conditional)
 *   - data-schema axes (distribution, derived, invariants, domain,
 *     discriminated unions, dataset with identity, eventually, correlate)
 *   - generator (`mock`) + validator (`parse`/`safeParse`)
 *   - debug / determinism (`createTrace`, `replay`, `expectStable`)
 *   - cross-dataset FK (`relate`)
 *   - extensibility (`walkSchema`, `fromIR`, low-level PRNG, IR types) for
 *     third-party packages (CLI, OpenAPI ingestion, zod adapters, …)
 *
 * databehave intentionally ships NO HTTP/server/framework integration. Wire it
 * into your transport of choice (Fastify/Express/msw/node:http) in ~80 LOC.
 */

// ── schema DSL ────────────────────────────────────────────────────────────
export { str, num, int, bool, null_, StringSchema, NumberSchema } from './schema/primitives.js'
export { decimal, DecimalSchema } from './schema/decimal.js'
export {
  obj,
  arr,
  tuple,
  union,
  literal,
  enum_,
  ObjectSchema,
  ArraySchema,
  TupleSchema,
  UnionSchema,
  LiteralSchema,
  EnumSchema,
} from './schema/composites.js'
export { discriminated } from './schema/conditional.js'

// ── generator + validator ─────────────────────────────────────────────────
export { mock, type MockOptions, type ModifierProbs, type StableByFn } from './generator/engine.js'
export { parse, safeParse, type SafeParseResult } from './validator/parse.js'
export {
  createTrace,
  type TraceAxis,
  type TraceCollector,
  type TraceEntry,
} from './generator/trace.js'
export { replay, expectStable, type Replay } from './generator/replay.js'

// ── dataset ───────────────────────────────────────────────────────────────
export { mockDataset, identityFor, type DatasetOptions } from './dataset/dataset.js'
export { relate, type RelateOptions } from './dataset/relate.js'

// ── foundation types & axes ───────────────────────────────────────────────
export { Schema, type Infer, type Modifiers, type SchemaNode } from './foundation/types.js'
export type {
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

// ── errors ────────────────────────────────────────────────────────────────
export {
  DataBehaveError,
  ConformError,
  SchemaConflictError,
  type Issue,
} from './foundation/errors.js'

// ── extensibility re-exports (use `databehave/internal` directly) ───────
// These re-exports are kept on the main entry for 0.x continuity. New
// code should import from `databehave/internal`; main-entry access will
// be removed in v1.0. See docs/STABILITY.md.
/** @deprecated import from `databehave/internal` instead. Removed in v1.0. */
export { walkSchema, fromIR, type SchemaVisitor, type WalkPath } from './foundation/walk.js'
/** @deprecated import from `databehave/internal` instead. Removed in v1.0. */
export { mulberry32, rngFromString, seedFromString, type Rng } from './foundation/prng.js'
