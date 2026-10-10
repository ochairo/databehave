/**
 * Replay / snapshot helpers — thin layer over `mock()` for tests.
 *
 * `replay(schema, opts)` returns a function bound to a fixed (seed, input)
 * pair. Calling it twice always returns deep-equal values; the function is
 * the canonical way to assert determinism in test suites.
 *
 * `expectStable(schema, opts)` runs the generator twice and throws if the
 * outputs differ — surfaces non-determinism introduced by misuse of
 * `derivedFrom` (e.g. reading `Date.now()`).
 */

import { isDeepStrictEqual } from 'node:util'

import { standardRuntime } from '../standard/runtime.js'
import type { RuntimeReplay } from '../runtime/runtime.js'
import { mock, type MockOptions } from './engine.js'
import type { Infer, Schema } from '../foundation/types.js'

/** A reusable standard-runtime generator with frozen options and contract identities. */
export type Replay<S extends Schema> = RuntimeReplay<S>

/** Bind the standard composition; custom schemas use runtime.replay. */
export const replay = <S extends Schema>(schema: S, options: MockOptions = {}): Replay<S> => standardRuntime.replay(schema, options)

/**
 * Run the generator twice with identical inputs and assert deep equality.
 * Returns the produced value on success; throws on divergence.
 *
 * **This is a diagnostic, not a determinism guarantee.** It runs the
 * schema *twice* with the same seed and compares the outputs
 * structurally — useful for catching obvious non-determinism (a
 * `derivedFrom` reading `Date.now()`, a stray `Math.random()`,
 * iteration over a `Set`), but two iterations cannot prove the entire
 * RNG sequence is fixed. The strong contract is {@link replay}, which
 * binds a (seed, input) pair and lets the caller pin the value at the
 * snapshot site.
 *
 * Treat `expectStable` as the equivalent of a smoke test: cheap to
 * keep in a regression suite, fast to fail loudly when a callback
 * goes off-piste, but not a substitute for `replay`-backed snapshots
 * for surfaces that must round-trip across releases.
 */
export const expectStable = <S extends Schema>(schema: S, options: MockOptions = {}): Infer<S> => {
  const a = mock(schema, options)
  const b = mock(schema, options)
  if (!isDeepStrictEqual(a, b)) {
    throw new Error(
      'expectStable: generator produced different values for identical seed/input — ' +
        'likely a non-deterministic derivedFrom callback (e.g. Date.now, Math.random, network).',
    )
  }
  return a
}
