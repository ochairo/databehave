/**
 * databehave/internal — low-level extensibility surface.
 *
 * Re-exports the IR walker and seeded PRNG primitives that exist for
 * third-party packages (CLI tools, OpenAPI ingestion, zod adapters, …)
 * to build on. These are versioned more loosely than the main DSL:
 *
 *   • SchemaNode / IR shape changes are MAJOR (see docs/STABILITY.md).
 *   • PRNG output is deterministic across PATCH/MINOR for a given seed.
 *
 * **Do not import from `databehave/internal` in application code.** Prefer
 * the high-level `mock()` / `parse()` / `safeParse()` from the package root.
 * Importing internals couples you to the IR and bypasses fail-loud guards.
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
