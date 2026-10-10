import type { GenContext } from '../foundation/axes.js'
import type { Rng } from '../foundation/prng.js'
import type { Schema, Infer } from '../foundation/types.js'
import type { TraceCollector } from './trace.js'
import { standardRuntime } from '../standard/runtime.js'

/**
 * Per-leaf stable-seed hook.
 *
 * Called for every leaf-value sampling (string/number/decimal/boolean/enum/domain).
 * Return a non-empty string to deterministically reseed *just this leaf*
 * (path-scoped) — useful for snapshot/CI runs where a subset of rows must
 * stay identical regardless of the outer `seed`.
 * Return `null`/`undefined`/`''` to fall back to the shared rng (normal random).
 *
 * Composite kinds (object/array/tuple/union) are unaffected; their children
 * re-enter this hook with their own path.
 */
export type StableByFn = (ctx: GenContext) => string | null | undefined

/**
 * Per-modifier probabilities for random injection during generation.
 *
 * These are opt-in. With the default `{ default: 0, optional: 0, nullable: 0 }`
 * `mock()` always samples a real value for the underlying type and never
 * silently substitutes the modifier short-circuit. Set a non-zero probability
 * to exercise the `undefined` / `null` / default-value paths.
 */
export type ModifierProbs = {
  /** Probability that `.default(v)` returns `v` instead of sampling. */
  readonly default?: number
  /** Probability that `.optional()` returns `undefined`. */
  readonly optional?: number
  /** Probability that `.nullable()` returns `null`. */
  readonly nullable?: number
}

export type MockOptions = {
  /** Override the deterministic seed. Either a string or unsigned 32-bit int. */
  readonly seed?: string | number
  /** Caller-supplied context channel exposed to derived/invariants as `ctx.input`. */
  readonly input?: Readonly<Record<string, unknown>>
  /** Top-level row index (used by `mockDataset` so per-row derived can read `ctx.index`). */
  readonly index?: number
  /** Optional trace collector — receives one entry per resolved field. */
  readonly trace?: TraceCollector
  /** Reseed leaf sampling deterministically from a caller-chosen key. */
  readonly stableBy?: StableByFn
  /**
   * Probabilities used for modifier short-circuits during sampling.
   *
   * Defaults are **all zero** — modifiers do not inject randomness unless you
   * explicitly opt in. This makes `mock()` exercise the underlying type by
   * default (e.g. `mock(str().optional())` always returns a string).
   */
  readonly modifierProbs?: ModifierProbs
  /**
   * Override the PRNG factory used when `seed` is a number.
   *
   * Defaults to `mulberry32`. When `seed` is a string the seed is
   * first hashed (`seedFromString`) and then handed to this factory.
   *
   * Useful for tests that need to inject a constant or recorded RNG to
   * exercise probability-driven branches deterministically. Production
   * callers should leave this unset — `mulberry32` is the seeded default
   * the determinism contract is calibrated against, and swapping it
   * perturbs the output sequence.
   */
  readonly prng?: (seed: number) => Rng
}

/** Generate using the explicit standard preset. Custom schemas use their composed runtime. */
export const mock = <S extends Schema>(schema: S, options: MockOptions = {}): Infer<S> => standardRuntime.mock(schema, options)
