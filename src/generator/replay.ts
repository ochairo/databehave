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

import { mock, type MockOptions } from './engine.js'
import type { Infer, Schema } from '../foundation/types.js'

/** A reusable, deterministic generator bound to a fixed seed/input. */
export type Replay<S extends Schema> = {
  /** Generate the value (always identical for identical bound options). */
  (): Infer<S>
  /** The frozen options used by this replay. */
  readonly options: Readonly<MockOptions>
}

/** Build a deterministic, repeatedly-callable generator. */
export const replay = <S extends Schema>(schema: S, options: MockOptions = {}): Replay<S> => {
  const frozen = deepFreeze({ ...options }) as MockOptions
  const fn = (() => mock(schema, frozen)) as unknown as Replay<S>
  Object.defineProperty(fn, 'options', { value: frozen, enumerable: true })
  return fn
}

/** Recursively `Object.freeze` plain objects and arrays so callers cannot
 *  mutate bound options through nested references (e.g. `options.input`). */
const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value
  if (Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const k of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[k])
  }
  return value
}

/**
 * Run the generator twice with identical inputs and assert deep equality.
 * Returns the produced value on success; throws on divergence.
 *
 * This is the executable form of databehave's determinism contract — use it in
 * regression suites to catch non-deterministic `derivedFrom` callbacks.
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
